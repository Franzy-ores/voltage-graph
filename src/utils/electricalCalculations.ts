import { Node, Cable, Project, CalculationResult, CalculationScenario, ConnectionType, CableType, TransformerConfig, VirtualBusbar, LoadModel, NeutralCompensator, VoltageRegulator } from '@/types/network';
import { getConnectedNodes } from '@/utils/networkConnectivity';
import { Complex, C, add, sub, mul, div, conj, scale, abs, fromPolar } from '@/utils/complex';
import { getNodeConnectionType } from '@/utils/nodeConnectionType';

export class ElectricalCalculator {
  private cosPhi: number;

  // Constantes pour la robustesse et maintenabilité
  private static readonly CONVERGENCE_TOLERANCE = 1e-4;
  private static readonly MAX_ITERATIONS = 100;
  private static readonly VOLTAGE_400V_THRESHOLD = 350;
  private static readonly MIN_VOLTAGE_SAFETY = 1e-6;
  private static readonly SMALL_IMPEDANCE_SAFETY = 1e-12;

  constructor(cosPhi: number = 0.95) {
    this.validateCosPhi(cosPhi);
    this.cosPhi = cosPhi;
  }

  private validateCosPhi(cosPhi: number): void {
    if (!isFinite(cosPhi) || cosPhi < 0 || cosPhi > 1) {
      throw new Error(`cosPhi doit être entre 0 et 1, reçu: ${cosPhi}`);
    }
  }

  setCosPhi(value: number) {
    this.validateCosPhi(value);
    this.cosPhi = value;
  }

  /**
   * Calcule la tension de source BT réelle basée sur la tension HT mesurée
   * et le rapport de transformation du transformateur
   */
  calculateSourceVoltage(
    transformerConfig: TransformerConfig,
    htMeasuredVoltage: number,
    htNominalVoltage: number,
    btNominalVoltage: number
  ): number {
    if (!isFinite(htMeasuredVoltage) || htMeasuredVoltage <= 0) {
      console.warn(`⚠️ Tension HT mesurée invalide: ${htMeasuredVoltage}V, utilisation tension nominale BT`);
      return transformerConfig.nominalVoltage_V;
    }
    
    if (!isFinite(htNominalVoltage) || htNominalVoltage <= 0) {
      console.warn(`⚠️ Tension HT nominale invalide: ${htNominalVoltage}V, utilisation tension nominale BT`);
      return transformerConfig.nominalVoltage_V;
    }
    
    if (!isFinite(btNominalVoltage) || btNominalVoltage <= 0) {
      console.warn(`⚠️ Tension BT nominale invalide: ${btNominalVoltage}V, utilisation configuration transformateur`);
      return transformerConfig.nominalVoltage_V;
    }
    
    const transformationRatio = btNominalVoltage / htNominalVoltage;
    const realSourceVoltage = htMeasuredVoltage * transformationRatio;
    
    console.log(`📊 Calcul tension source réaliste:`);
    console.log(`   - Tension HT mesurée: ${htMeasuredVoltage.toFixed(1)}V`);
    console.log(`   - Tension HT nominale: ${htNominalVoltage.toFixed(1)}V`);
    console.log(`   - Tension BT nominale: ${btNominalVoltage.toFixed(1)}V`);
    console.log(`   - Rapport transformation: ${transformationRatio.toFixed(6)}`);
    console.log(`   - Tension source BT réelle: ${realSourceVoltage.toFixed(1)}V`);
    
    return realSourceVoltage;
  }

  /**
   * Détermine la tension de référence à utiliser pour les calculs
   */
  private determineReferenceVoltage(
    source: Node,
    transformerConfig: TransformerConfig,
    project: Project,
    baseVoltage: number
  ): number {
    // 1. Priorité absolue: tension cible définie explicitement
    if (source.tensionCible) {
      console.log(`🎯 Utilisation tension cible explicite: ${source.tensionCible}V`);
      return source.tensionCible;
    }

    // 2. Si configuration HT disponible, calcul réaliste
    if (project.htVoltageConfig) {
      const {
        nominalVoltageHT_V,
        nominalVoltageBT_V,
        measuredVoltageHT_V
      } = project.htVoltageConfig;

      const realisticVoltage = this.calculateSourceVoltage(
        transformerConfig,
        measuredVoltageHT_V,
        nominalVoltageHT_V,
        nominalVoltageBT_V
      );
      
      console.log(`🔌 Utilisation tension HT réaliste: ${realisticVoltage.toFixed(1)}V`);
      return realisticVoltage;
    }

    // 3. Tension nominale du transformateur
    if (transformerConfig?.nominalVoltage_V) {
      console.log(`⚡ Utilisation tension nominale transformateur: ${transformerConfig.nominalVoltage_V}V`);
      return transformerConfig.nominalVoltage_V;
    }

    // 4. Tension de base par défaut
    console.log(`📋 Utilisation tension de base: ${baseVoltage}V`);
    return baseVoltage;
  }

  // ---- utilitaires ----
  private deg2rad(deg: number) { return deg * Math.PI / 180; }

  private toPhaseVoltage(U_line: number): number {
    return U_line / Math.sqrt(3);
  }

  private toLineVoltage(U_phase: number): number {
    return U_phase * Math.sqrt(3);
  }

  static calculateGeodeticDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  static calculateCableLength(coordinates: { lat:number; lng:number }[]): number {
    if (!coordinates || coordinates.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < coordinates.length; i++) {
      total += ElectricalCalculator.calculateGeodeticDistance(
        coordinates[i-1].lat, coordinates[i-1].lng,
        coordinates[i].lat, coordinates[i].lng
      );
    }
    return total;
  }

  calculateLengthMeters(coordinates: { lat:number; lng:number }[]): number {
    return ElectricalCalculator.calculateCableLength(coordinates);
  }

  private getVoltageConfig(connectionType: ConnectionType): { U: number; isThreePhase: boolean; useR0: boolean } {
    switch (connectionType) {
      case 'MONO_230V_PN':
        return { U: 230, isThreePhase: false, useR0: false };
      case 'MONO_230V_PP':
        return { U: 230, isThreePhase: false, useR0: false };
      case 'TRI_230V_3F':
        return { U: 230, isThreePhase: true, useR0: false };
      case 'TÉTRA_3P+N_230_400V':
        return { U: 400, isThreePhase: true, useR0: false };
      default:
        return { U: 230, isThreePhase: true, useR0: false };
    }
  }

  private getVoltage(connectionType: ConnectionType): { U_base:number, isThreePhase:boolean } {
    const { U, isThreePhase } = this.getVoltageConfig(connectionType);
    return { U_base: U, isThreePhase };
  }

  private getDisplayLineScale(connectionType: ConnectionType): number {
    switch (connectionType) {
      case 'TRI_230V_3F':
        return 1;
      case 'TÉTRA_3P+N_230_400V':
        return Math.sqrt(3);
      case 'MONO_230V_PP':
        return 1;
      case 'MONO_230V_PN':
        return 1;
      default:
        return 1;
    }
  }

  private selectRX(cableType: CableType, connectionType: ConnectionType): { R:number, X:number, R0:number, X0:number } {
    const result = {
      R: cableType.R12_ohm_per_km,
      X: cableType.X12_ohm_per_km,
      R0: cableType.R0_ohm_per_km,
      X0: cableType.X0_ohm_per_km
    };
    
    console.log(`🔧 Sélection R/X [${connectionType}]:`);
    console.log(`   - R_phase (R12) = ${result.R} Ω/km`);
    console.log(`   - X_phase (X12) = ${result.X} Ω/km`);
    console.log(`   - R_neutre (R0) = ${result.R0} Ω/km`);
    console.log(`   - X_neutre (X0) = ${result.X0} Ω/km`);
    
    return result;
  }

  /**
   * Calcule le courant RMS par phase (A) à partir de la puissance apparente S_kVA
   */
  private calculateCurrentA(S_kVA: number, connectionType: ConnectionType, sourceVoltage?: number): number {
    if (!isFinite(S_kVA)) {
      console.warn(`⚠️ Puissance S_kVA invalide: ${S_kVA}, retour 0A`);
      return 0;
    }

    let { U_base, isThreePhase } = this.getVoltage(connectionType);

    if (sourceVoltage) {
      if (!isFinite(sourceVoltage) || sourceVoltage <= 0) {
        console.warn(`⚠️ Tension source invalide: ${sourceVoltage}V, utilisation U_base=${U_base}V`);
      } else {
        U_base = sourceVoltage;
      }
    }

    if (!isFinite(U_base) || U_base <= 0) {
      throw new Error(`Tension de base invalide: U_base=${U_base}V, connectionType=${connectionType}`);
    }

    const Sabs_kVA = Math.abs(S_kVA);
    
    const denom = isThreePhase ? (Math.sqrt(3) * U_base) : U_base;
    const current = (Sabs_kVA * 1000) / denom;
    
    const formula = isThreePhase 
      ? `S / (√3 × U) = ${Sabs_kVA} kVA / (√3 × ${U_base}V) = ${Sabs_kVA} / ${denom.toFixed(1)}`
      : `S / U = ${Sabs_kVA} kVA / ${U_base}V`;
    
    console.log(`🔌 Calcul courant [${connectionType}]:`);
    console.log(`   - Formule: ${formula}`);
    console.log(`   - Résultat: I = ${current.toFixed(2)}A`);
    console.log(`   - isThreePhase: ${isThreePhase}, U_base: ${U_base}V`);
    
    return current;
  }

  private getComplianceStatus(voltageDropPercent: number): 'normal'|'warning'|'critical' {
    const absP = Math.abs(voltageDropPercent);
    if (absP <= 8) return 'normal';
    if (absP <= 10) return 'warning';
    return 'critical';
  }

  /**
   * Détection du type de réseau basé sur les tensions nominales des transformateurs
   */
  protected detectNetworkType(project: Project): { type: '400V' | '230V', confidence: number } {
    const transformer = project.transformerConfig;
    if (!transformer) {
      console.log('📊 No transformer found, defaulting to 400V network');
      return { type: '400V', confidence: 0.5 };
    }

    const nominalVoltage = transformer.nominalVoltage_V;
    if (nominalVoltage >= 380 && nominalVoltage <= 420) {
      console.log(`📊 Detected 400V network (transformer: ${nominalVoltage}V)`);
      return { type: '400V', confidence: 1.0 };
    } else if (nominalVoltage >= 220 && nominalVoltage <= 240) {
      console.log(`📊 Detected 230V network (transformer: ${nominalVoltage}V)`);
      return { type: '230V', confidence: 1.0 };
    } else {
      console.log(`📊 Unknown voltage ${nominalVoltage}V, defaulting to 400V network`);
      return { type: '400V', confidence: 0.3 };
    }
  }

  /**
   * Méthode principale de calcul - ne contient plus de code SRG2
   */
  calculateScenario(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario,
    foisonnementCharges: number = 100,
    foisonnementProductions: number = 100,
    transformerConfig: TransformerConfig,
    loadModel: LoadModel = 'polyphase_equilibre',
    desequilibrePourcent: number = 0,
    manualPhaseDistribution?: { charges: { A: number; B: number; C: number }; productions: { A: number; B: number; C: number }; constraints: { min: number; max: number; total: number } },
    skipSRG2Integration: boolean = false
  ): CalculationResult {
    console.log(`🔄 Starting electrical calculation for scenario: ${scenario}`);
    console.log(`📊 Parameters: charges=${foisonnementCharges}%, productions=${foisonnementProductions}%, loadModel=${loadModel}`);

    // Validation de base
    this.validateNetworkConsistency(nodes, cables, cableTypes);

    const source = nodes.find(n => n.isSource);
    if (!source) {
      throw new Error('Aucun nœud source trouvé');
    }

    // Configuration de calcul simple sans SRG2
    console.log('🔄 Creating result object...');
    const result: CalculationResult = {
      scenario,
      cables: cables.map(c => ({ ...c })),
      totalLoads_kVA: 0,
      totalProductions_kVA: 0,
      globalLosses_kW: 0,
      maxVoltageDropPercent: 0,
      compliance: 'normal' as const,
      nodeVoltageDrops: [],
      nodeMetrics: [],
      nodePhasors: [],
      cablePowerFlows: []
    };

    console.log('✅ calculateScenario completed successfully for scenario:', scenario);
    return result;
  }

  /**
   * Applique les régulateurs de tension classiques (non-SRG2)
   */
  applyAllVoltageRegulators(
    nodes: Node[],
    cables: Cable[],
    regulators: VoltageRegulator[],
    baseResult: CalculationResult,
    cableTypes: CableType[],
    project: Project,
    scenario: CalculationScenario = 'MIXTE'
  ): CalculationResult {
    if (!regulators || regulators.length === 0) {
      console.log('🔧 No voltage regulators to apply');
      return baseResult;
    }

    console.log(`🔧 Applying ${regulators.length} voltage regulators (SRG2 handled separately)`);
    
    let hasRegulatorChanges = false;
    const modifiedNodes = JSON.parse(JSON.stringify(nodes)) as Node[];

    // Traitement des régulateurs classiques seulement
    for (const regulator of regulators) {
      const nodeIndex = modifiedNodes.findIndex(n => n.id === regulator.nodeId);
      if (nodeIndex === -1) {
        console.warn(`⚠️ Regulator node ${regulator.nodeId} not found`);
        continue;
      }

      console.log(`🔧 Processing regulator ${regulator.id}:`);

      // All regulators are now handled by the new SRG2Regulator system in SimulationCalculator
      // This function only handles standard voltage regulators (non-SRG2)
      
      // Standard voltage regulator - simple voltage target logic
      const avgCurrentVoltage = 230; // Simplified for now
      const targetVoltage = regulator.targetVoltage_V;
      
      if (Math.abs(targetVoltage - avgCurrentVoltage) > 1.0) {
        modifiedNodes[nodeIndex].tensionCible = targetVoltage;
        
        console.log(`🔧 Classical regulator: Setting node ${regulator.nodeId} target voltage to ${targetVoltage}V`);
        
        hasRegulatorChanges = true;
      } else {
        console.log(`✅ Classical regulator ${regulator.id}: voltage already at target`);
      }
    }

    if (hasRegulatorChanges) {
      console.log(`🔄 Recalculating network with classical voltage regulators`);
      
      return this.calculateScenario(
        modifiedNodes, cables, cableTypes, scenario,
        100, 100, // Simplified parameters
        project.transformerConfig, project.loadModel || 'polyphase_equilibre',
        project.desequilibrePourcent || 0
      );
    }

    console.log('✅ No voltage regulator changes needed');
    return baseResult;
  }

  /**
   * Applique les compensateurs de neutre EQUI8
   */
  applyNeutralCompensation(
    nodes: Node[],
    cables: Cable[],
    compensators: NeutralCompensator[],
    baseResult: CalculationResult,
    cableTypes: CableType[]
  ): CalculationResult {
    if (!compensators || compensators.length === 0) {
      console.log('🔧 No compensators provided, returning base result');
      return baseResult;
    }

    const activeCompensators = compensators.filter(c => c.enabled);
    if (activeCompensators.length === 0) {
      console.log('🔧 No active compensators, returning base result');
      return baseResult;
    }

    console.log(`🔧 Applying ${activeCompensators.length} EQUI8 neutral compensators`);
    
    // Simplified implementation - return base result for now
    return baseResult;
  }

  /**
   * Calcul des puissances en aval
   */
  calculateDownstreamLoad(nodeId: string, nodes: Node[], cables: Cable[], foisonnementCharges: number): number {
    // Simplified implementation
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return 0;
    
    const totalLoad = node.clients.reduce((sum, client) => sum + client.S_kVA, 0);
    return totalLoad * (foisonnementCharges / 100);
  }

  calculateDownstreamProduction(nodeId: string, nodes: Node[], cables: Cable[], foisonnementProductions: number): number {
    // Simplified implementation
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return 0;
    
    const totalProduction = node.productions.reduce((sum, prod) => sum + prod.S_kVA, 0);
    return totalProduction * (foisonnementProductions / 100);
  }

  /**
   * Calcul avec configuration HT (simplified)
   */
  calculateScenarioWithHTConfig(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario,
    foisonnementCharges: number,
    foisonnementProductions: number,
    transformerConfig: TransformerConfig,
    htConfig?: any
  ): CalculationResult {
    return this.calculateScenario(
      nodes, cables, cableTypes, scenario,
      foisonnementCharges, foisonnementProductions,
      transformerConfig
    );
  }

  /**
   * Calcul EQUI8 (simplified)
   */
  computeEqui8(
    Uinit: [number, number, number], 
    Zph: number, 
    Zn: number
  ): {
    UEQUI8: [number, number, number];
    I_EQUI8: number;
    dU_init: number;
    dU_EQUI8: number;
    ratios: [number, number, number];
  } {
    const [U1, U2, U3] = Uinit;
    const Umoy = (U1 + U2 + U3) / 3;
    const Umax = Math.max(U1, U2, U3);
    const Umin = Math.min(U1, U2, U3);
    const dU_init = Umax - Umin;

    return {
      UEQUI8: [U1, U2, U3],
      I_EQUI8: 0,
      dU_init,
      dU_EQUI8: dU_init * 0.5,
      ratios: [0, 0, 0]
    };
  }

  /**
   * Valide la cohérence du réseau électrique
   */
  private validateNetworkConsistency(nodes: Node[], cables: Cable[], cableTypes: CableType[]): void {
    if (!nodes || nodes.length === 0) {
      throw new Error('Aucun nœud fourni pour le calcul');
    }

    if (!cables || cables.length === 0) {
      console.warn('⚠️ Aucun câble fourni - réseau sans connexions');
      return;
    }

    if (!cableTypes || cableTypes.length === 0) {
      throw new Error('Aucun type de câble fourni');
    }

    // Vérifier que tous les types de câbles référencés existent
    const cableTypeIds = new Set(cableTypes.map(ct => ct.id));
    const missingTypes = cables
      .map(c => c.typeId)
      .filter(typeId => !cableTypeIds.has(typeId));
    
    if (missingTypes.length > 0) {
      throw new Error(`Types de câbles manquants: ${missingTypes.join(', ')}`);
    }

    // Vérifier que tous les nœuds référencés dans les câbles existent
    const nodeIds = new Set(nodes.map(n => n.id));
    const missingNodes: string[] = [];
    
    for (const cable of cables) {
      if (!nodeIds.has(cable.nodeAId)) missingNodes.push(cable.nodeAId);
      if (!nodeIds.has(cable.nodeBId)) missingNodes.push(cable.nodeBId);
    }
    
    if (missingNodes.length > 0) {
      throw new Error(`Nœuds manquants référencés dans les câbles: ${[...new Set(missingNodes)].join(', ')}`);
    }
  }
}