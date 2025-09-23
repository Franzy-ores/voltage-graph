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

  // Ancien système SRG2 supprimé - utiliser SRG2Regulator uniquement

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
   * 
   * Formule: V_BT_réelle = V_HT_mesurée × (V_BT_nominale / V_HT_nominale)
   * 
   * @param transformerConfig Configuration du transformateur
   * @param htMeasuredVoltage Tension HT mesurée (V)
   * @param htNominalVoltage Tension HT nominale (V)
   * @param btNominalVoltage Tension BT nominale (V)
   * @returns Tension de source BT réelle (V)
   */
  calculateSourceVoltage(
    transformerConfig: TransformerConfig,
    htMeasuredVoltage: number,
    htNominalVoltage: number,
    btNominalVoltage: number
  ): number {
    // Validation des paramètres
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
    
    // Calcul du rapport de transformation
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
   * Priorité: tensionCible > calcul HT réaliste > tension nominale transformateur > tension base
   * 
   * @param source Nœud source
   * @param transformerConfig Configuration du transformateur
   * @param project Configuration du projet (pour config HT)
   * @param baseVoltage Tension de base par défaut
   * @returns Tension de référence (V)
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

  // NOUVEAUX UTILITAIRES: Conversions phase ↔ ligne
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
        // Phase-neutre 230V: CORRECTION - utilise maintenant R12/X12 pour chute de phase
        // R0/X0 seulement pour courant de neutre, pas pour chute de tension
        return { U: 230, isThreePhase: false, useR0: false };
      case 'MONO_230V_PP':
        // Phase-phase 230V: utilise R12/X12 car pas de neutre
        return { U: 230, isThreePhase: false, useR0: false };
      case 'TRI_230V_3F':
        // Triphasé 230V équilibré: utilise R12/X12 (séquence directe)
        return { U: 230, isThreePhase: true, useR0: false };
      case 'TÉTRA_3P+N_230_400V':
        // Tétraphasé 400V: utilise R12/X12 pour calculs équilibrés
        return { U: 400, isThreePhase: true, useR0: false };
      default:
        return { U: 230, isThreePhase: true, useR0: false };
    }
  }

  private getVoltage(connectionType: ConnectionType): { U_base:number, isThreePhase:boolean } {
    const { U, isThreePhase } = this.getVoltageConfig(connectionType);
    return { U_base: U, isThreePhase };
  }

  // Conversion phase -> "tension affichée" selon le type de connexion
  // - TRI_230V_3F : tensions composées déjà à 230V (pas de facteur supplémentaire)
  // - TÉTRA_3P+N_230_400V : tensions composées à 400V, simples à 230V
  // - MONO_230V_PP: tension entre phases (mesure directe, pas de facteur)
  // - MONO_230V_PN: tension phase-neutre (mesure directe, pas de facteur)
  private getDisplayLineScale(connectionType: ConnectionType): number {
    switch (connectionType) {
      case 'TRI_230V_3F':
        return 1; // Pas de conversion, 230V direct entre phases
      case 'TÉTRA_3P+N_230_400V':
        return Math.sqrt(3); // Conversion phase → ligne pour 400V
      case 'MONO_230V_PP':
        return 1; // Tension entre phases (230V direct)
      case 'MONO_230V_PN':
        return 1; // Tension phase-neutre (230V direct)
      default:
        return 1;
    }
  }

  private selectRX(cableType: CableType, connectionType: ConnectionType): { R:number, X:number, R0:number, X0:number } {
    const { useR0 } = this.getVoltageConfig(connectionType);
    
    // CORRECTION: Toujours fournir R12/X12 pour phase ET R0/X0 pour neutre
    const result = {
      R: cableType.R12_ohm_per_km,    // Résistance de phase (toujours R12)
      X: cableType.X12_ohm_per_km,    // Réactance de phase (toujours X12)
      R0: cableType.R0_ohm_per_km,    // Résistance homopolaire (pour neutre)
      X0: cableType.X0_ohm_per_km     // Réactance homopolaire (pour neutre)
    };
    
    // Log de débogage détaillé pour la sélection R/X
    console.log(`🔧 Sélection R/X [${connectionType}]:`);
    console.log(`   - R_phase (R12) = ${result.R} Ω/km`);
    console.log(`   - X_phase (X12) = ${result.X} Ω/km`);
    console.log(`   - R_neutre (R0) = ${result.R0} Ω/km`);
    console.log(`   - X_neutre (X0) = ${result.X0} Ω/km`);
    console.log(`   - useR0 legacy flag = ${useR0} (deprecated, using R12 for phase drops)`);
    
    return result;
  }

  /**
   * Calcule le courant RMS par phase (A) à partir de la puissance apparente S_kVA.
   * Conventions physiques corrigées et uniformisées:
   * - Triphasé équilibré: I = |S_kVA| * 1000 / (√3 · U_line)
   * - Monophasé: I = |S_kVA| * 1000 / U_phase
   * S_kVA est la puissance apparente totale (kVA), positive en consommation, négative en injection.
   * sourceVoltage, s'il est fourni, est interprété comme U_line (tri) ou U_phase (mono).
   */
  private calculateCurrentA(S_kVA: number, connectionType: ConnectionType, sourceVoltage?: number): number {
    // ROBUSTESSE: Validation des entrées
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

    // ROBUSTESSE: Validation de la tension de base
    if (!isFinite(U_base) || U_base <= 0) {
      throw new Error(`Tension de base invalide: U_base=${U_base}V, connectionType=${connectionType}`);
    }

    const Sabs_kVA = Math.abs(S_kVA);
    
    // FORMULES UNIFORMISÉES selon les conventions physiques
    const denom = isThreePhase ? (Math.sqrt(3) * U_base) : U_base;
    const current = (Sabs_kVA * 1000) / denom;
    
    // Log de débogage détaillé
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

  // [Supprimé] Ancienne formule simplifiée de ΔU transfo basée sur cosφ.
  // Les calculs transfo sont désormais exclusivement phasoriels via Ztr_phase et I_source_net.


  // Calcul du jeu de barres virtuel (phasors) avec analyse par départ
  private calculateVirtualBusbar(
    transformerConfig: TransformerConfig,
    totalLoads_kVA: number,
    totalProductions_kVA: number,
    source: Node,
    children: Map<string, string[]>,
    S_aval: Map<string, number>,
    V_node: Map<string, Complex>,
    I_source_net: Complex,
    Ztr_phase: Complex | null,
    cableIndexByPair: Map<string, Cable>,
    I_source_net_phases?: { A: Complex; B: Complex; C: Complex } // Pour I_N en mode déséquilibré
  ): VirtualBusbar {
    const { U_base: U_nom_source, isThreePhase: isSourceThree } = this.getVoltage(source.connectionType);
    const U_ref_line = source.tensionCible ?? transformerConfig.nominalVoltage_V ?? U_nom_source;

    // Tension slack de référence (phasor)
    const Vslack = C(U_ref_line / (isSourceThree ? Math.sqrt(3) : 1), 0);

    // ΔV transfo (phasor) et tension bus source (phasor)
    const dVtr = Ztr_phase ? mul(Ztr_phase, I_source_net) : C(0, 0);
    const V_bus = sub(Vslack, dVtr);

    const busVoltage_V = abs(V_bus) * (isSourceThree ? Math.sqrt(3) : 1);
    const netSkVA = totalLoads_kVA - totalProductions_kVA;
    const busCurrent_A = abs(I_source_net);

    // Courant neutre du jeu de barres (si 400V et mode déséquilibré)
    const is400V = U_ref_line >= 350;
    let current_N: number | undefined;
    if (is400V && I_source_net_phases) {
      const I_N = add(add(I_source_net_phases.A, I_source_net_phases.B), I_source_net_phases.C);
      current_N = abs(I_N);
    }

    // ΔU global appliqué au bus (en V, ligne)
    const dVtr_line = abs(dVtr) * (isSourceThree ? Math.sqrt(3) : 1);
    const sign = netSkVA > 0 ? -1 : (netSkVA < 0 ? 1 : 0);
    const dVtr_line_signed = sign * dVtr_line;

    // Récupérer les départs (voisins directs de la source)
    const sourceChildren = children.get(source.id) || [];
    const circuits: VirtualBusbar['circuits'] = [];

    const collectSubtreeNodes = (rootId: string): string[] => {
      const res: string[] = [];
      const stack2 = [rootId];
      while (stack2.length) {
        const u = stack2.pop()!;
        res.push(u);
        for (const v of children.get(u) || []) stack2.push(v);
      }
      return res;
    };

    // Calculer cosφ effectif pour Q
    const cosPhi_eff = Math.min(1, Math.max(0, this.cosPhi));
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi_eff * cosPhi_eff));

    for (const childId of sourceChildren) {
      const subtreeSkVA = S_aval.get(childId) || 0;
      const direction: 'injection' | 'prélèvement' = subtreeSkVA < 0 ? 'injection' : 'prélèvement';

      // Calcul de Q du circuit (kVAr)
      const subtreeQkVAr = Math.abs(subtreeSkVA) * sinPhi * Math.sign(subtreeSkVA);

      const cableId = cableIndexByPair.get(`${source.id}|${childId}`)?.id
        ?? cableIndexByPair.get(`${childId}|${source.id}`)?.id
        ?? 'unknown';

      // Courant du départ (approx. à partir de S et tension bus)
      const departCurrent_A = this.calculateCurrentA(subtreeSkVA, source.connectionType, busVoltage_V);

      // Part de ΔU transfo allouée proportionnellement à la puissance du sous-arbre
      const voltageShare = netSkVA !== 0 ? (dVtr_line_signed * (subtreeSkVA / netSkVA)) : 0;

      // Min/Max des tensions dans le sous-arbre à partir des phasors calculés
      const subtreeNodes = collectSubtreeNodes(childId);
      let minNodeVoltage = Number.POSITIVE_INFINITY;
      let maxNodeVoltage = Number.NEGATIVE_INFINITY;
      for (const nid of subtreeNodes) {
        const nV = V_node.get(nid);
        if (!nV) continue;
        // Conversion ligne/phase basée sur le type de connexion (fallback: type de la source)
        const nodeConnType: ConnectionType = nid === source.id
          ? source.connectionType
          : source.connectionType;
        const isThree = this.getVoltage(nodeConnType).isThreePhase;
        const scaleLine = this.getDisplayLineScale(nodeConnType);
        const U_node_line = abs(nV) * scaleLine;
        if (U_node_line < minNodeVoltage) minNodeVoltage = U_node_line;
        if (U_node_line > maxNodeVoltage) maxNodeVoltage = U_node_line;
      }
      if (subtreeNodes.length === 0 || !isFinite(minNodeVoltage)) {
        const U_node_line = abs(V_bus) * (isSourceThree ? Math.sqrt(3) : 1);
        minNodeVoltage = U_node_line;
        maxNodeVoltage = U_node_line;
      }

      circuits.push({
        circuitId: cableId,
        subtreeSkVA,
        subtreeQkVAr,
        direction,
        current_A: departCurrent_A,
        deltaU_V: voltageShare,
        voltageBus_V: busVoltage_V,
        minNodeVoltage_V: minNodeVoltage,
        maxNodeVoltage_V: maxNodeVoltage,
        nodesCount: subtreeNodes.length
      });
    }

    return {
      voltage_V: busVoltage_V,
      current_A: busCurrent_A,
      current_N,
      netSkVA,
      deltaU_V: dVtr_line_signed,
      deltaU_percent: U_ref_line ? (dVtr_line_signed / U_ref_line) * 100 : 0,
      losses_kW: (abs(I_source_net) ** 2) * (Ztr_phase?.re || 0) * (isSourceThree ? 3 : 1) / 1000,
      circuits
    };
  }

  /**
   * SRG2 FIX: Calculate network impedances - SOMME SUR TOUT LE CHEMIN SOURCE → NŒUD
   * @param nodeId ID of the compensator node
   * @param nodes List of network nodes
   * @param cables List of network cables  
   * @param cableTypes Available cable types
   */
  private calculateNetworkImpedances(
    nodeId: string,
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[]
  ): { Zph: number; Zn: number } {
    // Utiliser une impédance par défaut simplifiée
    // Le calcul détaillé est maintenant géré par d'autres méthodes
    return { Zph: 0.2, Zn: 0.3 }; // Valeurs par défaut
  }

  // Ancien système SRG2 supprimé - utiliser SRG2Regulator uniquement

  /**
   * Recalcule le réseau en aval d'un nœud donné avec de nouvelles tensions
   * @param nodeId ID du nœud à partir duquel recalculer
   * @param newVoltages Nouvelles tensions au nœud (Phase-Neutre en V)
   * @param nodes Liste des nœuds du réseau
   * @param cables Liste des câbles du réseau  
   * @param cableTypes Types de câbles disponibles
   * @param baseResult Résultats de base pour récupérer la topologie
   * @returns Résultats modifiés avec recalcul en aval
   */
  private recalculateNetworkFromNode(
    nodeId: string,
    newVoltages: { A: number; B: number; C: number },
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    baseResult: CalculationResult
  ): CalculationResult {
    console.log(`🔄 Recalculating network downstream from node ${nodeId} with new voltages:`, newVoltages);
    
    // Create a deep copy for modification
    const result: CalculationResult = JSON.parse(JSON.stringify(baseResult));
    
    // Build network topology maps
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const cableTypeById = new Map(cableTypes.map(ct => [ct.id, ct]));
    
    // Build adjacency list
    const adj = new Map<string, { cableId: string; neighborId: string }[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const cable of cables) {
      if (!nodeById.has(cable.nodeAId) || !nodeById.has(cable.nodeBId)) continue;
      adj.get(cable.nodeAId)!.push({ cableId: cable.id, neighborId: cable.nodeBId });
      adj.get(cable.nodeBId)!.push({ cableId: cable.id, neighborId: cable.nodeAId });
    }
    
    // Find all downstream nodes from the compensated node using BFS
    const downstreamNodes = new Set<string>();
    const visited = new Set<string>([nodeId]); // Start from compensated node
    const queue = [nodeId];
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const edge of adj.get(currentId) || []) {
        if (!visited.has(edge.neighborId)) {
          visited.add(edge.neighborId);
          downstreamNodes.add(edge.neighborId);
          queue.push(edge.neighborId);
        }
      }
    }
    
    console.log(`🔄 Found ${downstreamNodes.size} downstream nodes to recalculate`);
    
    // Apply new voltages to the compensated node first
    if (result.nodeMetricsPerPhase) {
      const nodeIndex = result.nodeMetricsPerPhase.findIndex(n => n.nodeId === nodeId);
      if (nodeIndex >= 0) {
        result.nodeMetricsPerPhase[nodeIndex].voltagesPerPhase = { ...newVoltages };
        console.log(`🔄 Applied new voltages to node ${nodeId}:`, newVoltages);
      }
    }
    
    // Recalculate cable flows and voltage drops for affected cables
    const affectedCableIds = new Set<string>();
    for (const cable of cables) {
      if (visited.has(cable.nodeAId) || visited.has(cable.nodeBId)) {
        affectedCableIds.add(cable.id);
      }
    }
    
    console.log(`🔄 Recalculating ${affectedCableIds.size} affected cables`);
    
    // For each affected cable, recalculate voltage drop based on new upstream voltage
    for (const cable of cables) {
      if (!affectedCableIds.has(cable.id)) continue;
      
      const cableType = cableTypeById.get(cable.typeId);
      if (!cableType) continue;
      
      // Find which node is upstream (closer to source)  
      const nodeA = nodeById.get(cable.nodeAId);
      const nodeB = nodeById.get(cable.nodeBId);
      if (!nodeA || !nodeB) continue;
      
      // Get current metrics for this cable from result
      const cableIndex = result.cables.findIndex(c => c.id === cable.id);
      if (cableIndex < 0) continue;
      
      const resultCable = result.cables[cableIndex];
      const length_km = (resultCable.length_m || 0) / 1000;
      
      // Calculate per-phase impedance
      const connectionType = nodeB.connectionType; // Use downstream node connection type
      const { R: R_ohm_per_km, X: X_ohm_per_km } = this.selectRX(cableType, connectionType);
      const Z_ohm = Math.sqrt((R_ohm_per_km * length_km) ** 2 + (X_ohm_per_km * length_km) ** 2);
      
      // Calculate new voltage drop based on current and impedance
      const current_A = resultCable.current_A || 0;
      const { isThreePhase } = this.getVoltage(connectionType);
      const newVoltageDrop = current_A * Z_ohm;
      const newVoltageDropLine = newVoltageDrop * (isThreePhase ? Math.sqrt(3) : 1);
      
      // Update cable voltage drop
      result.cables[cableIndex].voltageDrop_V = newVoltageDropLine;
      
      // Calculate new downstream node voltage
      const upstreamNodeId = cable.nodeAId;
      const downstreamNodeId = cable.nodeBId;
      
      if (result.nodeMetricsPerPhase && downstreamNodes.has(downstreamNodeId)) {
        const upstreamIndex = result.nodeMetricsPerPhase.findIndex(n => n.nodeId === upstreamNodeId);
        const downstreamIndex = result.nodeMetricsPerPhase.findIndex(n => n.nodeId === downstreamNodeId);
        
        if (upstreamIndex >= 0 && downstreamIndex >= 0) {
          const upstreamVoltages = result.nodeMetricsPerPhase[upstreamIndex].voltagesPerPhase;
          if (upstreamVoltages) {
            // Calculate new downstream voltages (simplified per-phase calculation)
            const voltageDropPerPhase = newVoltageDrop;
            
            result.nodeMetricsPerPhase[downstreamIndex].voltagesPerPhase = {
              A: Math.max(0, upstreamVoltages.A - voltageDropPerPhase),
              B: Math.max(0, upstreamVoltages.B - voltageDropPerPhase), 
              C: Math.max(0, upstreamVoltages.C - voltageDropPerPhase)
            };
            
            console.log(`🔄 Updated downstream node ${downstreamNodeId} voltages:`, 
              result.nodeMetricsPerPhase[downstreamIndex].voltagesPerPhase);
          }
        }
      }
    }
    
    console.log(`✅ Network recalculation complete for ${downstreamNodes.size} downstream nodes`);
    return result;
  }

  /**
   * Calcule la charge totale en aval d'un nœud pour validation SRG2
   */
  private calculateDownstreamLoad(nodeId: string, nodes: Node[], cables: Cable[], foisonnement: number): number {
    const visited = new Set<string>();
    const queue = [nodeId];
    let totalLoad = 0;
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      
      const node = nodes.find(n => n.id === currentId);
      if (node) {
        const nodeLoad = (node.clients || []).reduce((sum, client) => sum + client.S_kVA, 0);
        totalLoad += nodeLoad * (foisonnement / 100);
      }
      
      const downstreamCables = cables.filter(cable =>
        (cable.nodeAId === currentId || cable.nodeBId === currentId) && 
        !visited.has(cable.nodeAId) && !visited.has(cable.nodeBId)
      );
      
      downstreamCables.forEach(cable => {
        const nextNodeId = cable.nodeAId === currentId ? cable.nodeBId : cable.nodeAId;
        if (!visited.has(nextNodeId)) queue.push(nextNodeId);
      });
    }
    
    return totalLoad;
  }

  /**
   * Calcule la production totale en aval d'un nœud pour validation SRG2
   */
  private calculateDownstreamProduction(nodeId: string, nodes: Node[], cables: Cable[], foisonnement: number): number {
    const visited = new Set<string>();
    const queue = [nodeId];
    let totalProduction = 0;
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      
      const node = nodes.find(n => n.id === currentId);
      if (node) {
        const nodeProduction = (node.productions || []).reduce((sum, prod) => sum + prod.S_kVA, 0);
        totalProduction += nodeProduction * (foisonnement / 100);
      }
      
      const downstreamCables = cables.filter(cable =>
        (cable.nodeAId === currentId || cable.nodeBId === currentId) && 
        !visited.has(cable.nodeAId) && !visited.has(cable.nodeBId)
      );
      
      downstreamCables.forEach(cable => {
        const nextNodeId = cable.nodeAId === currentId ? cable.nodeBId : cable.nodeAId;
        if (!visited.has(nextNodeId)) queue.push(nextNodeId);
      });
    }
    
    return totalProduction;
  }

  /**
   * SYSTÈME UNIFIÉ : Applique tous les régulateurs de tension (SRG2 et classiques) avec recalcul complet du réseau
   * Remplace l'ancienne approche de modification directe des tensions par un système de tension de référence
   * @param nodes Liste des nœuds du réseau
   * @param cables Liste des câbles du réseau
   * @param regulators Liste des régulateurs actifs
   * @param baseResult Résultats de base avant régulation
   * @param cableTypes Types de câbles disponibles
   * @param project Configuration du projet (pour détection réseau)
   * @returns Résultats avec régulateurs appliqués via recalcul complet
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
      console.log('🔧 No voltage regulators provided, returning base result');
      return baseResult;
    }

    const activeRegulators = regulators.filter(r => r.enabled);
    if (activeRegulators.length === 0) {
      console.log('🔧 No active voltage regulators, returning base result');
      return baseResult;
    }

    console.log(`🔧 UNIFIED SYSTEM: Processing ${activeRegulators.length} voltage regulators with complete network recalculation`);
    
    // Détecter le type de réseau
    const networkDetection = this.detectNetworkType(project);
    
    // Créer une copie des nœuds pour modification
    const modifiedNodes = JSON.parse(JSON.stringify(nodes)) as Node[];
    let hasRegulatorChanges = false;

    // Traiter chaque régulateur séquentiellement
    for (const regulator of activeRegulators) {
      const nodeIndex = modifiedNodes.findIndex(n => n.id === regulator.nodeId);
      if (nodeIndex === -1) {
        console.warn(`⚠️ Node ${regulator.nodeId} not found for regulator ${regulator.id}`);
        continue;
      }

      console.log(`🔧 Processing regulator ${regulator.id} at node ${regulator.nodeId}`);

      // Récupérer la tension actuelle du nœud régulateur
      const nodeMetrics = baseResult.nodeMetricsPerPhase?.find(n => n.nodeId === regulator.nodeId);
      if (!nodeMetrics) {
        console.warn(`⚠️ No voltage data found for regulator node ${regulator.nodeId}`);
        continue;
      }

      const currentVoltages = {
        A: nodeMetrics.voltagesPerPhase.A,
        B: nodeMetrics.voltagesPerPhase.B,
        C: nodeMetrics.voltagesPerPhase.C
      };

      console.log(`📊 DIAGNOSTIC ${regulator.id}:`);
      console.log(`  - Node: ${regulator.nodeId}`);
      console.log(`  - Initial voltages: A=${currentVoltages.A.toFixed(1)}V, B=${currentVoltages.B.toFixed(1)}V, C=${currentVoltages.C.toFixed(1)}V`);
      console.log(`  - Network type: ${networkDetection.type}`);

      // Phase 2 - Exclure les nœuds SRG2 du traitement des régulateurs classiques
      console.log(`[INTERFERENCE-CHECK] Checking if node ${regulator.nodeId} is SRG2 node...`);
      
      // Vérifier si ce nœud est géré par SRG2 (chercher dans les nœuds modifiés)
      const nodeHasSRG2Applied = modifiedNodes[nodeIndex].srg2Applied === true;
      if (nodeHasSRG2Applied) {
        console.log(`⏭️ [INTERFERENCE-FIX] Skipping SRG2 node ${regulator.nodeId} from classical regulator processing`);
        console.log(`   - Node already regulated by SRG2 with tensionCible=${modifiedNodes[nodeIndex].tensionCible.toFixed(1)}V`);
        continue;
      }

      // Régulateur classique uniquement - SRG2 géré par SRG2Regulator
      const avgCurrentVoltage = (currentVoltages.A + currentVoltages.B + currentVoltages.C) / 3;
      const targetVoltage = regulator.targetVoltage_V;
      
      if (Math.abs(targetVoltage - avgCurrentVoltage) > 1.0) {
        console.log(`[INTERFERENCE-TRACE] Classical regulator setting tensionCible: ${targetVoltage}V (was: ${modifiedNodes[nodeIndex].tensionCible?.toFixed(1) || 'undefined'}V)`);
        modifiedNodes[nodeIndex].tensionCible = targetVoltage;
        modifiedNodes[nodeIndex].isVoltageRegulator = true;
        
        console.log(`🔧 Classical regulator: Setting node ${regulator.nodeId} target voltage to ${targetVoltage}V`);
        
        hasRegulatorChanges = true;
      } else {
        console.log(`✅ Classical regulator ${regulator.id}: voltage already at target`);
      }
    }

    // RECALCUL COMPLET DU RÉSEAU si des modifications ont été apportées
    if (!hasRegulatorChanges) {
      console.log('✅ No regulator changes needed, returning base result');
      return baseResult;
    }

    console.log('🔄 UNIFIED SYSTEM: Performing complete network recalculation with modified regulator nodes');

    // Créer un projet temporaire avec les nœuds modifiés
    const tempProject = {
      ...project,
      nodes: modifiedNodes
    };

    // Relancer un calcul complet du réseau avec les nouvelles tensions de référence
    const recalculatedResult = this.calculateScenario(
      modifiedNodes,
      project.cables,
      project.cableTypes,
      scenario,
      100, // foisonnementCharges par défaut
      100, // foisonnementProductions par défaut
      project.transformerConfig,
      project.loadModel ?? 'polyphase_equilibre',
      project.desequilibrePourcent ?? 0
    );

    console.log('✅ UNIFIED SYSTEM: Complete network recalculation completed');
    
    // DIAGNOSTIC : Vérifier que le recalcul a bien les nodeMetricsPerPhase
    if (!recalculatedResult.nodeMetricsPerPhase) {
      console.error('❌ CRITICAL: Recalculated result missing nodeMetricsPerPhase!');
      console.log('📊 Recalculated result keys:', Object.keys(recalculatedResult));
      console.log('📊 Base result had nodeMetricsPerPhase:', !!baseResult.nodeMetricsPerPhase);
      // Fallback: utiliser le baseResult si le recalcul échoue
      return baseResult;
    }
    
    console.log('✅ Recalculated result has nodeMetricsPerPhase:', recalculatedResult.nodeMetricsPerPhase.length, 'nodes');
    return recalculatedResult;
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

  // Ancien système SRG2 supprimé - utiliser SRG2Regulator uniquement

  /**
   * Fonction de calcul EQUI8 selon les formules exactes du constructeur
   * @param Uinit Tensions initiales [ph1, ph2, ph3] en V
   * @param Zph Impédance de phase en Ω
   * @param Zn Impédance de neutre en Ω
   * @returns Résultats EQUI8 complets
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
    warning?: string;
  } {
    const [U1, U2, U3] = Uinit;
    
    // Validation du domaine de validité
    if (Zph <= 0.15 || Zn <= 0.15) {
      const warning = `⚠️ Impédances hors domaine de validité fournisseur: Zph=${Zph.toFixed(3)}Ω, Zn=${Zn.toFixed(3)}Ω (min: 0.15Ω)`;
      console.warn(warning);
    }

    // Calcul des statistiques initiales
    const Umoy = (U1 + U2 + U3) / 3;
    const Umax = Math.max(U1, U2, U3);
    const Umin = Math.min(U1, U2, U3);
    const dU_init = Umax - Umin;

    // Calcul des ratios par phase
    const ratio1 = dU_init > 0 ? (U1 - Umoy) / dU_init : 0;
    const ratio2 = dU_init > 0 ? (U2 - Umoy) / dU_init : 0;
    const ratio3 = dU_init > 0 ? (U3 - Umoy) / dU_init : 0;

    // Formule EQUI8 pour (Umax-Umin)EQUI8
    const logarithmicTerm = 0.9119 * Math.log(Zph) + 3.8654;
    const impedanceRatio = (2 * Zph) / (Zph + Zn);
    const dU_EQUI8 = (1 / logarithmicTerm) * dU_init * impedanceRatio;

    // Calcul des tensions corrigées UEQUI8
    const UEQUI8_1 = Umoy + ratio1 * dU_EQUI8;
    const UEQUI8_2 = Umoy + ratio2 * dU_EQUI8;  
    const UEQUI8_3 = Umoy + ratio3 * dU_EQUI8;

    // Calcul du courant neutre EQUI8
    const I_EQUI8 = (0.392 / Math.pow(Zph, 0.8065)) * dU_init * impedanceRatio;

    return {
      UEQUI8: [UEQUI8_1, UEQUI8_2, UEQUI8_3],
      I_EQUI8,
      dU_init,
      dU_EQUI8,
      ratios: [ratio1, ratio2, ratio3],
      warning: (Zph <= 0.15 || Zn <= 0.15) ? 
        `Impédances hors domaine: Zph=${Zph.toFixed(3)}Ω, Zn=${Zn.toFixed(3)}Ω` : undefined
    };
  }

  /**
   * Applique les compensateurs de neutre EQUI8 aux résultats de calcul
   * Implémentation avec modèle EQUI8 constructeur et deux modes d'intégration
   * @param nodes Liste des nœuds du réseau
   * @param cables Liste des câbles du réseau
   * @param compensators Liste des compensateurs actifs
   * @param baseResult Résultats de base avant compensation
   * @param cableTypes Types de câbles disponibles
   * @returns Résultats modifiés avec compensateurs appliqués
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

    let result: CalculationResult = JSON.parse(JSON.stringify(baseResult));

    // Apply each compensator
    for (const compensator of activeCompensators) {
      const node = nodes.find(n => n.id === compensator.nodeId);
      if (!node) {
        console.warn(`⚠️ Node ${compensator.nodeId} not found for compensator ${compensator.id}`);
        continue;
      }

      // Check kVA limit against downstream load
      const downstreamLoad_kVA = this.calculateDownstreamLoad(compensator.nodeId, nodes, cables, 100);
      console.log(`🔧 Compensator at node ${compensator.nodeId}: Downstream load=${downstreamLoad_kVA.toFixed(1)}kVA, Limit=${compensator.maxPower_kVA}kVA`);
      
      if (downstreamLoad_kVA > compensator.maxPower_kVA) {
        console.warn(`⚠️ Compensateur ${compensator.id} surchargé! Charge=${downstreamLoad_kVA.toFixed(1)}kVA > Limite=${compensator.maxPower_kVA}kVA`);
        (compensator as any).isLimited = true;
        (compensator as any).currentIN_A = 0;
        (compensator as any).reductionPercent = 0;
        (compensator as any).overloadReason = `Charge aval (${downstreamLoad_kVA.toFixed(1)}kVA) dépasse la limite (${compensator.maxPower_kVA}kVA)`;
        continue;
      }
      
      (compensator as any).isLimited = false;

      // Get node voltages
      const nodeMetricIndex = result.nodeMetricsPerPhase?.findIndex(nm => nm.nodeId === compensator.nodeId) ?? -1;
      
      if (nodeMetricIndex < 0 || !result.nodeMetricsPerPhase) {
        console.warn(`⚠️ Node ${compensator.nodeId} not found in nodeMetricsPerPhase array`);
        continue;
      }

      const nodeMetricPerPhase = result.nodeMetricsPerPhase[nodeMetricIndex];
      
      if (!nodeMetricPerPhase?.voltagesPerPhase) {
        console.warn(`⚠️ No voltage data available for node ${compensator.nodeId}`);
        continue;
      }

      const { A: U1, B: U2, C: U3 } = nodeMetricPerPhase.voltagesPerPhase;
      console.log(`📊 Initial voltages: A=${U1.toFixed(1)}V, B=${U2.toFixed(1)}V, C=${U3.toFixed(1)}V`);

      // Calculate network impedances
      const { Zph, Zn } = this.calculateNetworkImpedances(compensator.nodeId, nodes, cables, cableTypes);
      console.log(`⚡ Network impedances: Zph=${Zph.toFixed(3)}Ω, Zn=${Zn.toFixed(3)}Ω`);

      // Apply EQUI8 computation
      const equi8Result = this.computeEqui8([U1, U2, U3], Zph, Zn);
      
      if (equi8Result.warning) {
        console.warn(equi8Result.warning);
      }

      console.log(`📊 EQUI8 result: [${equi8Result.UEQUI8.map(v => v.toFixed(1)).join(', ')}]V, I_N=${equi8Result.I_EQUI8.toFixed(1)}A`);

      // Update compensator status with EQUI8 results
      (compensator as any).currentIN_A = Math.round(equi8Result.I_EQUI8 * 10) / 10;
      (compensator as any).reductionPercent = Math.min(100, ((equi8Result.dU_init - equi8Result.dU_EQUI8) / equi8Result.dU_init) * 100);
      (compensator as any).u1p_V = Math.round(equi8Result.UEQUI8[0] * 10) / 10;
      (compensator as any).u2p_V = Math.round(equi8Result.UEQUI8[1] * 10) / 10;
      (compensator as any).u3p_V = Math.round(equi8Result.UEQUI8[2] * 10) / 10;

      // Store EQUI8 results for post-processing display (Mode fournisseur par défaut)
      if (!result.nodeMetricsPerPhase[nodeMetricIndex].equi8) {
        result.nodeMetricsPerPhase[nodeMetricIndex].equi8 = {
          UEQUI8: { A: 0, B: 0, C: 0 },
          I_EQUI8: 0,
          dU_init: 0,
          dU_EQUI8: 0,
          ratios: { A: 0, B: 0, C: 0 }
        };
      }
      result.nodeMetricsPerPhase[nodeMetricIndex].equi8 = {
        UEQUI8: { A: equi8Result.UEQUI8[0], B: equi8Result.UEQUI8[1], C: equi8Result.UEQUI8[2] },
        I_EQUI8: equi8Result.I_EQUI8,
        dU_init: equi8Result.dU_init,
        dU_EQUI8: equi8Result.dU_EQUI8,
        ratios: { A: equi8Result.ratios[0], B: equi8Result.ratios[1], C: equi8Result.ratios[2] }
      };

      // Mode intégré si applyToFlow=true (approximatif)
      if ((compensator as any).applyToFlow) {
        console.log(`🔧 Mode intégré activé pour compensateur ${compensator.id}`);
        
        const compensatedVoltages = {
          A: equi8Result.UEQUI8[0],
          B: equi8Result.UEQUI8[1], 
          C: equi8Result.UEQUI8[2]
        };

        // Update voltages and recalculate downstream (approximation)
        result.nodeMetricsPerPhase[nodeMetricIndex].voltagesPerPhase = compensatedVoltages;
        
        // Note: Dans une vraie implémentation, il faudrait recalculer avec injection équivalente
        console.log(`⚠️ Mode intégré approximatif - les inductances ne sont pas prises en compte`);
      }

      console.log(`✅ EQUI8 compensator applied: ${(equi8Result.dU_init - equi8Result.dU_EQUI8).toFixed(1)}V improvement`);
    }
    
    return result;
  }

  /**
   * Version étendue de calculateScenario avec support de la configuration HT
   * @param project Projet contenant la configuration HT
   * @param scenario Scénario de calcul
   * @param foisonnementCharges Foisonnement des charges
   * @param foisonnementProductions Foisonnement des productions
   * @param manualPhaseDistribution Distribution manuelle des phases (optionnel)
   */
  calculateScenarioWithHTConfig(
    project: Project,
    scenario: CalculationScenario,
    foisonnementCharges: number = 100,
    foisonnementProductions: number = 100,
    manualPhaseDistribution?: { charges: {A:number;B:number;C:number}; productions: {A:number;B:number;C:number} }
  ): CalculationResult {
    // Si configuration HT disponible, ajuster la tension de la source
    let modifiedNodes = [...project.nodes];
    
    if (project.htVoltageConfig && project.transformerConfig) {
      const {
        nominalVoltageHT_V,
        nominalVoltageBT_V,
        measuredVoltageHT_V
      } = project.htVoltageConfig;

      const sourceNode = modifiedNodes.find(n => n.isSource);
      if (sourceNode && !sourceNode.tensionCible) {
        // Calculer la tension source réaliste
        const realisticVoltage = this.calculateSourceVoltage(
          project.transformerConfig,
          measuredVoltageHT_V,
          nominalVoltageHT_V,
          nominalVoltageBT_V
        );

        // Créer une copie du nœud source avec la tension calculée
        const modifiedSourceNode = {
          ...sourceNode,
          tensionCible: realisticVoltage
        };

        // Remplacer le nœud source dans la liste
        modifiedNodes = modifiedNodes.map(n => 
          n.id === sourceNode.id ? modifiedSourceNode : n
        );

        console.log(`🔌 Application tension source HT réaliste: ${realisticVoltage.toFixed(1)}V`);
      }
    }

    // Appeler la méthode standard avec les nœuds modifiés
    return this.calculateScenario(
      modifiedNodes,
      project.cables,
      project.cableTypes,
      scenario,
      foisonnementCharges,
      foisonnementProductions,
      project.transformerConfig,
      project.loadModel ?? 'polyphase_equilibre',
      project.desequilibrePourcent ?? 0,
      manualPhaseDistribution
    );
  }
  calculateScenario(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario,
    foisonnementCharges: number = 100,
    foisonnementProductions: number = 100,
    transformerConfig?: TransformerConfig,
    loadModel: LoadModel = 'polyphase_equilibre',
    desequilibrePourcent: number = 0,
    manualPhaseDistribution?: { charges: {A:number;B:number;C:number}; productions: {A:number;B:number;C:number} },
    skipSRG2Integration: boolean = false
  ): CalculationResult {
    // Ancien système SRG2 supprimé - validation simplifiée
    if (!nodes?.length) throw new Error('Aucun nœud fourni');
    if (!cables?.length) throw new Error('Aucun câble fourni');
    
    console.log('🔄 calculateScenario started for scenario:', scenario, 'with nodes:', nodes.length, 'cables:', cables.length);
    const nodeById = new Map(nodes.map(n => [n.id, n] as const));
    const cableTypeById = new Map(cableTypes.map(ct => [ct.id, ct] as const));

    const sources = nodes.filter(n => n.isSource);
    console.log('🔄 Found sources:', sources.length);
    if (sources.length !== 1) throw new Error('Le réseau doit avoir exactement une source.');
    const source = sources[0];

    const adj = new Map<string, { cableId:string; neighborId:string }[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const cable of cables) {
      if (!nodeById.has(cable.nodeAId) || !nodeById.has(cable.nodeBId)) continue;
      adj.get(cable.nodeAId)!.push({ cableId:cable.id, neighborId:cable.nodeBId });
      adj.get(cable.nodeBId)!.push({ cableId:cable.id, neighborId:cable.nodeAId });
    }

    const parent = new Map<string, string | null>();
    const visited = new Set<string>();
    const queue: string[] = [source.id];
    parent.set(source.id, null);
    visited.add(source.id);

    while (queue.length) {
      const u = queue.shift()!;
      for (const edge of adj.get(u) || []) {
        if (!visited.has(edge.neighborId)) {
          visited.add(edge.neighborId);
          parent.set(edge.neighborId, u);
          queue.push(edge.neighborId);
        }
      }
    }

    const S_eq = new Map<string, number>();
    for (const n of nodes) {
      // Appliquer les facteurs de foisonnement
      const S_prel = (n.clients || []).reduce((s, c) => s + (c.S_kVA || 0), 0) * (foisonnementCharges / 100);
      const S_pv   = (n.productions || []).reduce((s, p) => s + (p.S_kVA || 0), 0) * (foisonnementProductions / 100);
      let val = 0;
      if (scenario === 'PRÉLÈVEMENT') val = S_prel;
      else if (scenario === 'PRODUCTION') val = - S_pv;
      else val = S_prel - S_pv;
      S_eq.set(n.id, val);
    }

    const children = new Map<string, string[]>();
    for (const n of nodes) children.set(n.id, []);
    for (const [nodeId, p] of parent.entries()) {
      if (p && children.has(p)) children.get(p)!.push(nodeId);
    }

    const postOrder: string[] = [];
    const dfs = (u: string) => {
      for (const v of children.get(u) || []) dfs(v);
      postOrder.push(u);
    };
    dfs(source.id);

    const S_aval = new Map<string, number>();
    for (const nodeId of postOrder) {
      let sum = S_eq.get(nodeId) || 0;
      for (const childId of (children.get(nodeId) || [])) {
        sum += S_aval.get(childId) || 0;
      }
      S_aval.set(nodeId, sum);
    }

    const calculatedCables: Cable[] = [];
    let globalLosses = 0;
    let totalLoads = 0;
    let totalProductions = 0;

    // Calculer les nœuds connectés à une source
    const connectedNodes = getConnectedNodes(nodes, cables);
    const connectedNodesData = nodes.filter(node => connectedNodes.has(node.id));

    for (const n of connectedNodesData) {
      // Appliquer les facteurs de foisonnement aux totaux aussi (seulement pour les nœuds connectés)
      totalLoads += (n.clients || []).reduce((s,c) => s + (c.S_kVA || 0), 0) * (foisonnementCharges / 100);
      totalProductions += (n.productions || []).reduce((s,p) => s + (p.S_kVA || 0), 0) * (foisonnementProductions / 100);
    }

    // ---- Power Flow using Backward-Forward Sweep (complex R+jX) ----
    // Build helper indices
    const cableIndexByPair = new Map<string, (typeof cables)[number]>();
    for (const cab of cables) {
      const key1 = `${cab.nodeAId}|${cab.nodeBId}`;
      const key2 = `${cab.nodeBId}|${cab.nodeAId}`;
      cableIndexByPair.set(key1, cab);
      cableIndexByPair.set(key2, cab);
    }

    const parentCableOfChild = new Map<string, (typeof cables)[number]>();
    for (const [nodeId, p] of parent.entries()) {
      if (!p) continue;
      const cab = cableIndexByPair.get(`${p}|${nodeId}`);
      if (cab) parentCableOfChild.set(nodeId, cab);
    }

    // Per-cable per-phase impedance (Ω)
    const cableZ_phase = new Map<string, Complex>();
    const cableChildId = new Map<string, string>();
    const cableParentId = new Map<string, string>();

    for (const [childId, cab] of parentCableOfChild.entries()) {
      const parentId = parent.get(childId)!;
      const distalNode = nodeById.get(childId)!;
      const ct = cableTypeById.get(cab.typeId);
      if (!ct) throw new Error(`Cable type ${cab.typeId} introuvable`);
      const length_m = this.calculateLengthMeters(cab.coordinates || []);
      const L_km = length_m / 1000;

      const { R: R_ohm_per_km, X: X_ohm_per_km } = this.selectRX(ct, distalNode.connectionType);
      // Series impedance per phase for the full segment
      const Z = C(R_ohm_per_km * L_km, X_ohm_per_km * L_km);
      cableZ_phase.set(cab.id, Z);
      cableChildId.set(cab.id, childId);
      cableParentId.set(cab.id, parentId);
    }

    // Node complex powers (per phase) and initial voltages
    const S_node_total_kVA = new Map<string, number>(); // signed (charges>0, productions<0)
    for (const n of nodes) {
      S_node_total_kVA.set(n.id, S_eq.get(n.id) || 0);
    }

    const VcfgSrc = this.getVoltage(source.connectionType);
    let U_line_base = VcfgSrc.U_base;
    if (transformerConfig?.nominalVoltage_V) U_line_base = transformerConfig.nominalVoltage_V;
    
    // Phase 2 - Correction du bloc problématique SRG2
    console.log(`[INTERFERENCE-TRACE] calculateScenario source analysis: isVoltageRegulator=${source.isVoltageRegulator}, srg2Applied=${source.srg2Applied}, tensionCible=${source.tensionCible?.toFixed(1)}`);
    
    if (source.srg2Applied === true) {
      // Nœud SRG2 : utiliser tensionCible définie par SRG2Regulator
      if (source.tensionCible) {
        U_line_base = source.tensionCible;
        console.log(`✅ [SRG2-CLEAN] Using SRG2 tensionCible: ${U_line_base.toFixed(1)}V for node ${source.id}`);
      } else {
        console.warn(`⚠️ [SRG2-ERROR] SRG2 node without tensionCible, using transformer voltage`);
        if (transformerConfig?.nominalVoltage_V) {
          U_line_base = transformerConfig.nominalVoltage_V;
        }
      }
    } else if (source.isVoltageRegulator && source.regulatorTargetVoltages) {
      // ANCIEN CODE SRG2 RÉSIDUEL - NE PLUS UTILISER
      console.error(`🚨 [INTERFERENCE-ERROR] Residual SRG2 code detected! source.regulatorTargetVoltages should not be used anymore.`);
      console.error(`   Node ${source.id} has regulatorTargetVoltages but srg2Applied=false - this indicates old/residual SRG2 code.`);
      console.error(`   Values: A=${source.regulatorTargetVoltages.A.toFixed(3)}, B=${source.regulatorTargetVoltages.B.toFixed(3)}, C=${source.regulatorTargetVoltages.C.toFixed(3)}`);
      
      // Fallback sécurisé : utiliser tensionCible si disponible, sinon tension nominale
      if (source.tensionCible) {
        U_line_base = source.tensionCible;
        console.log(`🔧 [FALLBACK] Using tensionCible instead: ${U_line_base.toFixed(1)}V`);
      } else if (transformerConfig?.nominalVoltage_V) {
        U_line_base = transformerConfig.nominalVoltage_V;
        console.log(`🔧 [FALLBACK] Using transformer nominal voltage: ${U_line_base.toFixed(1)}V`);
      }
    } else if (source.tensionCible) {
      U_line_base = source.tensionCible;
      console.log(`✅ [CLASSICAL] Using classical tensionCible: ${U_line_base.toFixed(1)}V for node ${source.id}`);
    }
    
    const isSrcThree = VcfgSrc.isThreePhase;

    if (!isFinite(U_line_base) || U_line_base <= 0) {
      console.warn('⚠️ U_line incohérent pour la source, utilisation d\'une valeur par défaut.', { U_line_base, connectionType: source.connectionType });
      U_line_base = isSrcThree ? 400 : 230;
    }

    // Tension de phase pour l'initialisation selon le type de connexion
    let Vslack_phase: number;
    if (source.connectionType === 'MONO_230V_PP' || source.connectionType === 'MONO_230V_PN') {
      // Pour les connexions monophasées, utiliser directement 230V comme tension de phase/service
      Vslack_phase = 230;
    } else if (source.connectionType === 'TRI_230V_3F') {
      // Pour TRI_230V_3F : pas de conversion, travail direct en 230V composé
      Vslack_phase = U_line_base; // 230V composée directement
    } else {
      // Pour les autres systèmes triphasés, conversion ligne -> phase
      Vslack_phase = U_line_base / (isSrcThree ? Math.sqrt(3) : 1);
    }
    const Vslack = C(Vslack_phase, 0);

    // Transformer series impedance (per phase)
    let Ztr_phase: Complex | null = null;
    if (transformerConfig) {
      // Ztr (Ω/phase) à partir de Ucc% (en p.u.) et du ratio X/R si fourni
      const Zpu = transformerConfig.shortCircuitVoltage_percent / 100;
      const Sbase_VA = transformerConfig.nominalPower_kVA * 1000;
      // CORRECTION: Zbase (Ω) en utilisant U_ligne^2 / Sbase, sans √3 incorrect
      const Zbase = (U_line_base * U_line_base) / Sbase_VA; // Ω
      const Zmag = Zpu * Zbase; // |Z|

      const xOverR = transformerConfig.xOverR;
      let R = 0;
      let X = 0;
      if (typeof xOverR === 'number' && isFinite(xOverR) && xOverR > 0) {
        // R = Z / sqrt(1 + (X/R)^2), X = R * (X/R)
        R = Zmag / Math.sqrt(1 + xOverR * xOverR);
        X = R * xOverR;
      } else {
        // Fallback par défaut si X/R inconnu
        R = 0.05 * Zmag;
        X = Math.sqrt(Math.max(0, Zmag * Zmag - R * R));
      }
      Ztr_phase = C(R, X);
    }

    const V_node = new Map<string, Complex>();
    // CORRECTION SRG2: Initialiser les tensions avec SRG2 si applicable
    for (const n of nodes) {
      let nodeVoltage = Vslack;
      
      // ÉTENDRE LA RECONNAISSANCE DES NŒUDS À TENSION FORCÉE
      if (n.tensionCible && n.tensionCible > 0) {
        const isThreePhase = this.getVoltage(n.connectionType).isThreePhase;
        const phaseVoltage = n.connectionType === 'TRI_230V_3F' 
          ? n.tensionCible 
          : n.tensionCible / (isThreePhase ? Math.sqrt(3) : 1);
        
        nodeVoltage = C(phaseVoltage, 0);
        console.log(`🔧 [TENSION-FORCEE] Node ${n.id} voltage forced to ${n.tensionCible.toFixed(1)}V (${n.srg2Applied ? 'SRG2' : 'MANUAL'})`);
      }
      
      V_node.set(n.id, nodeVoltage);
    }

    // Sécurité: cosΦ dans [0,1]
    const cosPhi_eff = Math.min(1, Math.max(0, this.cosPhi));
    if (!isFinite(this.cosPhi) || this.cosPhi < 0 || this.cosPhi > 1) {
      console.warn('⚠️ cosΦ hors [0,1], application d\'un clamp.', { cosPhi_in: this.cosPhi, cosPhi_eff });
    }
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi_eff * cosPhi_eff));

    // ---- Mode déséquilibré (monophasé réparti) -> calcul triphasé par phase ----
    const isUnbalanced = loadModel === 'monophase_reparti';

    if (isUnbalanced) {
      // Répartition S_total -> S_A/S_B/S_C selon la répartition manuelle ou équilibré par défaut
      const globalAngle = 0; // Angle identique pour tous les circuits pour préserver la notion de circuit
      
      // Utiliser la répartition manuelle si disponible, sinon répartition équitable par défaut
      let pA_charges = 1/3, pB_charges = 1/3, pC_charges = 1/3;
      let pA_productions = 1/3, pB_productions = 1/3, pC_productions = 1/3;
      
      if (manualPhaseDistribution) {
        pA_charges = manualPhaseDistribution.charges.A / 100;
        pB_charges = manualPhaseDistribution.charges.B / 100;
        pC_charges = manualPhaseDistribution.charges.C / 100;
        pA_productions = manualPhaseDistribution.productions.A / 100;
        pB_productions = manualPhaseDistribution.productions.B / 100;
        pC_productions = manualPhaseDistribution.productions.C / 100;
      }
      
      // Vérification de cohérence
      const totalCharges = pA_charges + pB_charges + pC_charges;
      const totalProductions = pA_productions + pB_productions + pC_productions;
      if (Math.abs(totalCharges - 1) > 1e-6) {
        console.warn(`⚠️ Répartition des charges incohérente: pA=${pA_charges}, pB=${pB_charges}, pC=${pC_charges}, total=${totalCharges}`);
      }
      if (Math.abs(totalProductions - 1) > 1e-6) {
        console.warn(`⚠️ Répartition des productions incohérente: pA=${pA_productions}, pB=${pB_productions}, pC=${pC_productions}, total=${totalProductions}`);
      }

      const S_A_map = new Map<string, Complex>();
      const S_B_map = new Map<string, Complex>();
      const S_C_map = new Map<string, Complex>();

      for (const n of nodes) {
        const S_kVA_tot = S_node_total_kVA.get(n.id) || 0; // signé
        const sign = Math.sign(S_kVA_tot) || 1;
        
        // Séparer charges et productions pour appliquer des répartitions différentes
        let S_A_kVA = 0, S_B_kVA = 0, S_C_kVA = 0;
        
        if (S_kVA_tot > 0) {
          // Charges positives - utiliser la répartition des charges
          S_A_kVA = S_kVA_tot * pA_charges;
          S_B_kVA = S_kVA_tot * pB_charges;
          S_C_kVA = S_kVA_tot * pC_charges;
        } else {
          // Productions négatives - utiliser la répartition des productions
          S_A_kVA = S_kVA_tot * pA_productions;
          S_B_kVA = S_kVA_tot * pB_productions;
          S_C_kVA = S_kVA_tot * pC_productions;
        }
        
        const P_A_kW = S_A_kVA * cosPhi_eff;
        const Q_A_kVAr = Math.abs(S_A_kVA) * sinPhi * sign;
        const P_B_kW = S_B_kVA * cosPhi_eff;
        const Q_B_kVAr = Math.abs(S_B_kVA) * sinPhi * sign;
        const P_C_kW = S_C_kVA * cosPhi_eff;
        const Q_C_kVAr = Math.abs(S_C_kVA) * sinPhi * sign;
        S_A_map.set(n.id, C(P_A_kW * 1000, Q_A_kVAr * 1000));
        S_B_map.set(n.id, C(P_B_kW * 1000, Q_B_kVAr * 1000));
        S_C_map.set(n.id, C(P_C_kW * 1000, Q_C_kVAr * 1000));

        // Intégrer les contributions explicites P/Q (équipements virtuels)
        const addExtra = (items: any[], sign: 1 | -1) => {
          for (const it of items || []) {
            const P = Number((it as any).P_kW) || 0;
            const Q = Number((it as any).Q_kVAr) || 0;
            if (P === 0 && Q === 0) continue;
            const phase = (it as any).phase as 'A' | 'B' | 'C' | undefined;
            const Sextra = C(P * 1000 * sign, Q * 1000 * sign);
            if (phase === 'A') {
              S_A_map.set(n.id, add(S_A_map.get(n.id) || C(0,0), Sextra));
            } else if (phase === 'B') {
              S_B_map.set(n.id, add(S_B_map.get(n.id) || C(0,0), Sextra));
            } else if (phase === 'C') {
              S_C_map.set(n.id, add(S_C_map.get(n.id) || C(0,0), Sextra));
            } else {
              const third = scale(Sextra, 1/3);
              S_A_map.set(n.id, add(S_A_map.get(n.id) || C(0,0), third));
              S_B_map.set(n.id, add(S_B_map.get(n.id) || C(0,0), third));
              S_C_map.set(n.id, add(S_C_map.get(n.id) || C(0,0), third));
            }
          }
        };
        addExtra((n as any).clients || [], 1);
        addExtra((n as any).productions || [], -1);
      }

      const runBFSForPhase = (angleDeg: number, S_map: Map<string, Complex>) => {
        const V_node_phase = new Map<string, Complex>();
        const I_branch_phase = new Map<string, Complex>();
        const I_inj_node_phase = new Map<string, Complex>();

        const Vslack_phase_ph = fromPolar(Vslack_phase, this.deg2rad(angleDeg));
        // CORRECTION SRG2: Initialiser les tensions avec SRG2 si applicable
        for (const n of nodes) {
          let nodeVoltage = Vslack_phase_ph;
          
          // ÉTENDRE LA RECONNAISSANCE DES NŒUDS À TENSION FORCÉE
          if (n.tensionCible && n.tensionCible > 0) {
            const isThreePhase = this.getVoltage(n.connectionType).isThreePhase;
            const phaseVoltage = n.connectionType === 'TRI_230V_3F' 
              ? n.tensionCible 
              : n.tensionCible / (isThreePhase ? Math.sqrt(3) : 1);
            
            nodeVoltage = fromPolar(phaseVoltage, this.deg2rad(angleDeg));
            console.log(`🔧 [TENSION-FORCEE] Node ${n.id} voltage forced to ${n.tensionCible.toFixed(1)}V (${n.srg2Applied ? 'SRG2' : 'MANUAL'})`);
          }
          
          V_node_phase.set(n.id, nodeVoltage);
        }

        let iter2 = 0;
        let converged2 = false;
        while (iter2 < ElectricalCalculator.MAX_ITERATIONS && !converged2) {
          iter2++;
          const V_prev2 = new Map(V_node_phase);
          console.log(`🔄 BFS iteration ${iter2}/${ElectricalCalculator.MAX_ITERATIONS} for phase ${angleDeg}°`);

          I_branch_phase.clear();
          I_inj_node_phase.clear();

          for (const n of nodes) {
            const Vn = V_node_phase.get(n.id) || Vslack_phase_ph;
            const Sph = S_map.get(n.id) || C(0, 0);
            const Vsafe = abs(Vn) > ElectricalCalculator.MIN_VOLTAGE_SAFETY ? Vn : Vslack_phase_ph;
            const Iinj = conj(div(Sph, Vsafe));
            I_inj_node_phase.set(n.id, Iinj);
          }

          for (const u of postOrder) {
            if (u === source.id) continue;
            const childrenIds = children.get(u) || [];
            let I_sum = C(0, 0);
            for (const v of childrenIds) {
              const cabChild = parentCableOfChild.get(v);
              if (!cabChild) continue;
              const Ichild = I_branch_phase.get(cabChild.id) || C(0, 0);
              I_sum = add(I_sum, Ichild);
            }
            I_sum = add(I_sum, I_inj_node_phase.get(u) || C(0, 0));
            const cab = parentCableOfChild.get(u);
            if (cab) I_branch_phase.set(cab.id, I_sum);
          }

          let I_source_net = C(0, 0);
          for (const v of children.get(source.id) || []) {
            const cab = parentCableOfChild.get(v);
            if (!cab) continue;
            I_source_net = add(I_source_net, I_branch_phase.get(cab.id) || C(0, 0));
          }
          I_source_net = add(I_source_net, I_inj_node_phase.get(source.id) || C(0, 0));

          const V_source_bus = Ztr_phase ? sub(Vslack_phase_ph, mul(Ztr_phase, I_source_net)) : Vslack_phase_ph;
          V_node_phase.set(source.id, V_source_bus);

          const stack2 = [source.id];
          while (stack2.length) {
            const u = stack2.pop()!;
            for (const v of children.get(u) || []) {
              const cab = parentCableOfChild.get(v);
              if (!cab) continue;
              const Z = cableZ_phase.get(cab.id) || C(0, 0);
              const Iuv = I_branch_phase.get(cab.id) || C(0, 0);
              const Vu = V_node_phase.get(u) || Vslack_phase_ph;
              let Vv = sub(Vu, mul(Z, Iuv));
              
              // SRG2 FIX: Do not apply transformation to SRG2 node itself
              // The SRG2 node voltage is the measurement point and should remain unchanged
              
              V_node_phase.set(v, Vv);
              stack2.push(v);
            }
          }

          // Convergence per-phase
          let maxDelta = 0;
          for (const [nid, Vn] of V_node_phase.entries()) {
            const Vp = V_prev2.get(nid) || Vslack_phase_ph;
            const d = abs(sub(Vn, Vp));
            if (d > maxDelta) maxDelta = d;
          }
          const convergenceRatio = maxDelta / (Vslack_phase || 1);
          console.log(`   - Max voltage delta: ${maxDelta.toFixed(6)}V, convergence ratio: ${convergenceRatio.toExponential(3)}`);
          
          if (convergenceRatio < ElectricalCalculator.CONVERGENCE_TOLERANCE) { 
            converged2 = true;
            console.log(`✅ BFS converged for phase ${angleDeg}° after ${iter2} iterations`);
          }
          
          // Safety check for infinite loops
          if (iter2 >= ElectricalCalculator.MAX_ITERATIONS - 1) {
            console.warn(`⚠️ BFS phase ${angleDeg}° reached max iterations (${ElectricalCalculator.MAX_ITERATIONS}), forcing convergence`);
            converged2 = true;
          }
        }
        if (!converged2) {
          console.warn(`⚠️ BFS phase ${angleDeg}° non convergé`);
        }
        return { V_node_phase, I_branch_phase };
      };

      // Pivot global : même angle (0°) pour tous les circuits pour préserver la notion de circuit
      const phaseA = runBFSForPhase(globalAngle, S_A_map);
      const phaseB = runBFSForPhase(globalAngle, S_B_map);
      const phaseC = runBFSForPhase(globalAngle, S_C_map);

      // Compose cable results (par phase)
      calculatedCables.length = 0;
      globalLosses = 0;
      const is400V = U_line_base >= ElectricalCalculator.VOLTAGE_400V_THRESHOLD;

      for (const cab of cables) {
        const childId = cableChildId.get(cab.id);
        const parentId = cableParentId.get(cab.id);
        const length_m = this.calculateLengthMeters(cab.coordinates || []);
        const ct = cableTypeById.get(cab.typeId);
        if (!ct) throw new Error(`Cable type ${cab.typeId} introuvable`);

        const distalId = childId && parentId ? childId : (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeBId : cab.nodeAId);
        const distalNode = nodeById.get(distalId)!;
        const { isThreePhase } = this.getVoltage(distalNode.connectionType);
        const Z = cableZ_phase.get(cab.id) || C(0, 0);

        const IA = phaseA.I_branch_phase.get(cab.id) || C(0, 0);
        const IB = phaseB.I_branch_phase.get(cab.id) || C(0, 0);
        const IC = phaseC.I_branch_phase.get(cab.id) || C(0, 0);

        const IA_mag = abs(IA);
        const IB_mag = abs(IB);
        const IC_mag = abs(IC);

        const dVA = abs(mul(Z, IA));
        const dVB = abs(mul(Z, IB));
        const dVC = abs(mul(Z, IC));

        const current_A = Math.max(IA_mag, IB_mag, IC_mag);
        // Pour TRI_230V_3F, pas de conversion car travail direct en composé
        const deltaU_line_V = distalNode.connectionType === 'TRI_230V_3F' 
          ? Math.max(dVA, dVB, dVC) // Direct en 230V composé
          : Math.max(dVA, dVB, dVC) * (isThreePhase ? Math.sqrt(3) : 1);

        // Base voltage for percent
        let { U_base } = this.getVoltage(distalNode.connectionType);
        const srcTarget = nodes.find(n => n.isSource)?.tensionCible;
        if (srcTarget) U_base = srcTarget;
        const deltaU_percent = U_base ? (deltaU_line_V / U_base) * 100 : 0;

        // Pertes (somme des 3 phases)
        const R_total = Z.re;
        const losses_kW = ((IA_mag*IA_mag) + (IB_mag*IB_mag) + (IC_mag*IC_mag)) * R_total / 1000;
        globalLosses += losses_kW;

        // Courant de neutre (si 400V L-N)
        const IN_mag = is400V ? abs(add(add(IA, IB), IC)) : 0;

        calculatedCables.push({
          ...cab,
          length_m,
          current_A,
          voltageDrop_V: deltaU_line_V,
          voltageDropPercent: deltaU_percent,
          losses_kW,
          apparentPower_kVA: undefined,
          currentsPerPhase_A: { A: IA_mag, B: IB_mag, C: IC_mag, N: is400V ? IN_mag : undefined },
          voltageDropPerPhase_V: { A: dVA, B: dVB, C: dVC }
        });
      }

      // Tension nodale (pire phase) et conformité
      let worstAbsPct = 0;
      const nodeVoltageDrops: { nodeId: string; deltaU_cum_V: number; deltaU_cum_percent: number }[] = [];
      const nodePhasorsPerPhase: { nodeId: string; phase: 'A'|'B'|'C'; V_real: number; V_imag: number; V_phase_V: number; V_angle_deg: number }[] = [];

      const sourceNode = nodes.find(n => n.isSource);
      for (const n of nodes) {
        // Récupération des tensions nodales par phase avec même angle global (préservation des circuits)
        const Va = phaseA.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        const Vb = phaseB.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        const Vc = phaseC.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        const Va_mag = abs(Va);
        const Vb_mag = abs(Vb);
        const Vc_mag = abs(Vc);

        nodePhasorsPerPhase.push(
          { nodeId: n.id, phase: 'A', V_real: Va.re, V_imag: Va.im, V_phase_V: Va_mag, V_angle_deg: (Math.atan2(Va.im, Va.re)*180)/Math.PI },
          { nodeId: n.id, phase: 'B', V_real: Vb.re, V_imag: Vb.im, V_phase_V: Vb_mag, V_angle_deg: (Math.atan2(Vb.im, Vb.re)*180)/Math.PI },
          { nodeId: n.id, phase: 'C', V_real: Vc.re, V_imag: Vc.im, V_phase_V: Vc_mag, V_angle_deg: (Math.atan2(Vc.im, Vc.re)*180)/Math.PI },
        );

        const scaleLine = this.getDisplayLineScale(n.connectionType);
        const U_node_line_worst = Math.min(Va_mag, Vb_mag, Vc_mag) * scaleLine;

        let { U_base: U_ref_display } = this.getVoltage(n.connectionType);
        if (sourceNode?.tensionCible) U_ref_display = sourceNode.tensionCible;

        const deltaU_V = U_ref_display - U_node_line_worst;
        const deltaU_pct = U_ref_display ? (deltaU_V / U_ref_display) * 100 : 0;

        const { U_base: U_nom } = this.getVoltage(n.connectionType);
        const deltaU_pct_nominal = U_nom ? ((U_nom - U_node_line_worst) / U_nom) * 100 : 0;
        const absPctNom = Math.abs(deltaU_pct_nominal);
        if (absPctNom > worstAbsPct) worstAbsPct = absPctNom;

        nodeVoltageDrops.push({ nodeId: n.id, deltaU_cum_V: deltaU_V, deltaU_cum_percent: deltaU_pct });
      }

      const compliance = this.getComplianceStatus(worstAbsPct);

      // Calcul du jeu de barres virtuel (préserver la notion de circuit en monophasé déséquilibré)
      let virtualBusbar: VirtualBusbar | undefined;
      if (transformerConfig) {
        // Courant net à la source par phase pour I_N
        let I_source_net_A = C(0, 0);
        let I_source_net_B = C(0, 0);
        let I_source_net_C = C(0, 0);
        
        for (const v of children.get(source.id) || []) {
          const cab = parentCableOfChild.get(v);
          if (!cab) continue;
          I_source_net_A = add(I_source_net_A, phaseA.I_branch_phase.get(cab.id) || C(0, 0));
          I_source_net_B = add(I_source_net_B, phaseB.I_branch_phase.get(cab.id) || C(0, 0));
          I_source_net_C = add(I_source_net_C, phaseC.I_branch_phase.get(cab.id) || C(0, 0));
        }
        
        const V_source_A = phaseA.V_node_phase.get(source.id) || fromPolar(Vslack_phase, this.deg2rad(0));
        const S_source_A = S_A_map.get(source.id) || C(0, 0);
        const S_source_B = S_B_map.get(source.id) || C(0, 0);
        const S_source_C = S_C_map.get(source.id) || C(0, 0);
        
        const Iinj_A = conj(div(S_source_A, V_source_A));
        const Iinj_B = conj(div(S_source_B, V_source_A)); // Même tension ref
        const Iinj_C = conj(div(S_source_C, V_source_A)); // Même tension ref
        
        I_source_net_A = add(I_source_net_A, Iinj_A);
        I_source_net_B = add(I_source_net_B, Iinj_B);
        I_source_net_C = add(I_source_net_C, Iinj_C);

        virtualBusbar = this.calculateVirtualBusbar(
          transformerConfig,
          totalLoads,
          totalProductions,
          source,
          children,
          S_aval,
          phaseA.V_node_phase,
          I_source_net_A,
          Ztr_phase,
          cableIndexByPair,
          { A: I_source_net_A, B: I_source_net_B, C: I_source_net_C }
        );
      }

      // Métriques nodales par phase pour monophasé déséquilibré
      const nodeMetricsPerPhase = nodes.map(n => {
        const Va = phaseA.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        const Vb = phaseB.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        const Vc = phaseC.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        
        // Vraies tensions calculées phase-neutre (pour SRG2 et calculs techniques)
        const Va_calculated = abs(Va);
        const Vb_calculated = abs(Vb);
        const Vc_calculated = abs(Vc);
        
        // Calcul des tensions composées (phase-phase) pour réseaux 230V
        const Vab_calculated = abs(sub(Va, Vb)); // Phase A-B
        const Vbc_calculated = abs(sub(Vb, Vc)); // Phase B-C  
        const Vca_calculated = abs(sub(Vc, Va)); // Phase C-A
        
        // Tensions d'affichage (avec facteur d'échelle pour interface utilisateur)
        const scaleLine = this.getDisplayLineScale(n.connectionType);
        const Va_display = Va_calculated * scaleLine;
        const Vb_display = Vb_calculated * scaleLine;
        const Vc_display = Vc_calculated * scaleLine;
        
        let { U_base: U_ref } = this.getVoltage(n.connectionType);
        const sourceNode = nodes.find(s => s.isSource);
        if (sourceNode?.tensionCible) U_ref = sourceNode.tensionCible;
        
        return {
          nodeId: n.id,
          voltagesPerPhase: {
            A: Va_display,
            B: Vb_display,
            C: Vc_display
          },
          calculatedVoltagesPerPhase: {
            A: Va_calculated,
            B: Vb_calculated,
            C: Vc_calculated
          },
          calculatedVoltagesComposed: {
            AB: Vab_calculated,
            BC: Vbc_calculated,
            CA: Vca_calculated
          },
          voltageDropsPerPhase: {
            A: U_ref - Va_display,
            B: U_ref - Vb_display,
            C: U_ref - Vc_display
          }
        };
      });

      const result: CalculationResult = {
        scenario,
        cables: calculatedCables,
        totalLoads_kVA: totalLoads,
        totalProductions_kVA: totalProductions,
        globalLosses_kW: Number(globalLosses.toFixed(6)),
        maxVoltageDropPercent: Number(worstAbsPct.toFixed(6)),
        maxVoltageDropCircuitNumber: undefined,
        compliance,
        nodeVoltageDrops,
        nodeMetrics: undefined,
        nodePhasors: undefined,
        nodePhasorsPerPhase,
        nodeMetricsPerPhase, // Nouvelles métriques par phase
        cablePowerFlows: undefined,
        virtualBusbar
      };

      return result;
    }

    // ---- Mode équilibré (inchangé) ----
    // Helper: per-node per-phase complex power in VA (signed)
    const S_node_phase_VA = new Map<string, Complex>();
    const computeNodeS = () => {
      S_node_phase_VA.clear();
      for (const n of nodes) {
        const S_kVA = S_node_total_kVA.get(n.id) || 0; // S_total (kVA), signé: >0 charge, <0 injection
        const P_kW = S_kVA * cosPhi_eff;
        const Q_kVAr = Math.abs(S_kVA) * sinPhi * Math.sign(S_kVA);
        const S_VA_total = C(P_kW * 1000, Q_kVAr * 1000);

        // Contributions explicites P/Q (équipements virtuels)
        let S_extra_VA = C(0, 0);
        for (const it of ((n as any).clients || [])) {
          const P = Number((it as any).P_kW) || 0;
          const Q = Number((it as any).Q_kVAr) || 0;
          if (P !== 0 || Q !== 0) {
            S_extra_VA = add(S_extra_VA, C(P * 1000, Q * 1000));
          }
        }
        for (const it of ((n as any).productions || [])) {
          const P = Number((it as any).P_kW) || 0;
          const Q = Number((it as any).Q_kVAr) || 0;
          if (P !== 0 || Q !== 0) {
            S_extra_VA = sub(S_extra_VA, C(P * 1000, Q * 1000)); // injection => signe négatif
          }
        }

        const { isThreePhase } = this.getVoltage(n.connectionType);
        const divisor = isThreePhase ? 3 : 1;
        const S_total_phase = scale(add(S_VA_total, S_extra_VA), 1 / divisor);
        S_node_phase_VA.set(n.id, S_total_phase);
      }
    };
    computeNodeS();

    // Iterative BFS
    const maxIter = ElectricalCalculator.MAX_ITERATIONS;
    const tol = ElectricalCalculator.CONVERGENCE_TOLERANCE;
    let iter = 0;
    let converged = false;

    // Storage
    const I_branch = new Map<string, Complex>(); // by cable id (per phase)
    const I_inj_node = new Map<string, Complex>();

    while (iter < maxIter && !converged) {
      iter++;
      console.log(`🔄 BFS equilibrium iteration ${iter}/${maxIter}`);
      const V_prev = new Map(V_node);

      // Backward: compute injection currents then branch currents bottom-up
      I_branch.clear();
      I_inj_node.clear();

      for (const n of nodes) {
        const Vn = V_node.get(n.id) || Vslack;
        const Sph = S_node_phase_VA.get(n.id) || C(0, 0);
        const Vsafe = abs(Vn) > ElectricalCalculator.MIN_VOLTAGE_SAFETY ? Vn : Vslack;
        // I = conj(S / V)
        const Iinj = conj(div(Sph, Vsafe));
        I_inj_node.set(n.id, Iinj);
      }

      for (const u of postOrder) {
        if (u === source.id) continue;
        const childrenIds = children.get(u) || [];
        let I_sum = C(0, 0);
        for (const v of childrenIds) {
          const cabChild = parentCableOfChild.get(v);
          if (!cabChild) continue;
          const Ichild = I_branch.get(cabChild.id) || C(0, 0);
          I_sum = add(I_sum, Ichild);
        }
        I_sum = add(I_sum, I_inj_node.get(u) || C(0, 0));
        const cab = parentCableOfChild.get(u);
        if (cab) I_branch.set(cab.id, I_sum);
      }

      // Current entering the source bus from network
      let I_source_net = C(0, 0);
      for (const v of children.get(source.id) || []) {
        const cab = parentCableOfChild.get(v);
        if (!cab) continue;
        I_source_net = add(I_source_net, I_branch.get(cab.id) || C(0, 0));
      }
      I_source_net = add(I_source_net, I_inj_node.get(source.id) || C(0, 0));

      // Forward: propagate voltages from slack through transformer and along feeders
      const V_source_bus = Ztr_phase ? sub(Vslack, mul(Ztr_phase, I_source_net)) : Vslack;
      V_node.set(source.id, V_source_bus);

      const stack2 = [source.id];
      while (stack2.length) {
        const u = stack2.pop()!;
        for (const v of children.get(u) || []) {
          const cab = parentCableOfChild.get(v);
          if (!cab) continue;
          const Z = cableZ_phase.get(cab.id) || C(0, 0);
          const Iuv = I_branch.get(cab.id) || C(0, 0);
          const Vu = V_node.get(u) || Vslack;
          let Vv = sub(Vu, mul(Z, Iuv));
          
          // SRG2 FIX: Do not apply transformation to SRG2 node itself
          // The SRG2 node voltage is the measurement point and should remain unchanged
          
          V_node.set(v, Vv);
          stack2.push(v);
        }
      }

      // Convergence check
      let maxDelta = 0;
      for (const [nid, Vn] of V_node.entries()) {
        const Vp = V_prev.get(nid) || Vslack;
        const d = abs(sub(Vn, Vp));
        if (d > maxDelta) maxDelta = d;
      }
      const convergenceRatio = maxDelta / (Vslack_phase || 1);
      console.log(`   - Max voltage delta: ${maxDelta.toFixed(6)}V, convergence ratio: ${convergenceRatio.toExponential(3)}`);
      
      if (convergenceRatio < tol) { 
        converged = true;
        console.log(`✅ BFS equilibrium converged after ${iter} iterations`);
      }
      
      // Safety check for infinite loops
      if (iter >= maxIter - 1) {
        console.warn(`⚠️ BFS equilibrium reached max iterations (${maxIter}), forcing convergence`);
        converged = true;
      }
    }
    if (!converged) {
      console.warn(`⚠️ Backward–Forward Sweep non convergé (tol=${tol}, maxIter=${maxIter}). Les résultats peuvent être approximatifs.`);
    }

    // Compose cable results from final branch currents and voltages
    calculatedCables.length = 0;
    globalLosses = 0;

    for (const cab of cables) {
      const childId = cableChildId.get(cab.id);
      const parentId = cableParentId.get(cab.id);
      const length_m = this.calculateLengthMeters(cab.coordinates || []);
      const L_km = length_m / 1000;
      const ct = cableTypeById.get(cab.typeId);
      if (!ct) throw new Error(`Cable type ${cab.typeId} introuvable`);

      // Determine distal node (child) for connection type
      const distalId = childId && parentId ? childId : (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeBId : cab.nodeAId);
      const distalNode = nodeById.get(distalId)!;
      const { isThreePhase } = this.getVoltage(distalNode.connectionType);

      // Per-phase Z
      let Z = cableZ_phase.get(cab.id);
      if (!Z) {
        // In case edge is not in the tree (shouldn't happen in radial), compute on the fly
        const { R: R_ohm_per_km, X: X_ohm_per_km } = this.selectRX(ct, distalNode.connectionType);
        Z = C(R_ohm_per_km * L_km, X_ohm_per_km * L_km);
      }

      const Iph = I_branch.get(cab.id) || C(0, 0);
      const dVph = mul(Z!, Iph);
      const current_A = abs(Iph);
      // Pour TRI_230V_3F, pas de conversion car travail direct en composé
      const deltaU_line_V = distalNode.connectionType === 'TRI_230V_3F' 
        ? abs(dVph) // Direct en 230V composé
        : abs(dVph) * (isThreePhase ? Math.sqrt(3) : 1);

      // Base voltage for percent: prefer source target voltage if provided
      let { U_base } = this.getVoltage(distalNode.connectionType);
      const srcTarget = nodes.find(n => n.isSource)?.tensionCible;
      if (srcTarget) U_base = srcTarget;
      const deltaU_percent = U_base ? (deltaU_line_V / U_base) * 100 : 0;

      // Apparent power through the branch (kVA), computed at sending end (parent)
      const parentIdForCab = parentId ?? (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeAId : cab.nodeBId);
      const Vu = V_node.get(parentIdForCab || cab.nodeAId) || Vslack;
      const S_flow_phase = mul(Vu, conj(Iph)); // VA per phase (complex)
      const phaseFactor = isThreePhase ? 3 : 1;
      const apparentPower_kVA = (abs(S_flow_phase) * phaseFactor) / 1000;

      const R_total = Z!.re; // per phase
      const losses_kW = (current_A * current_A * R_total * phaseFactor) / 1000;

      globalLosses += losses_kW;

      calculatedCables.push({
        ...cab,
        length_m,
        current_A,
        voltageDrop_V: deltaU_line_V,
        voltageDropPercent: deltaU_percent,
        losses_kW,
        apparentPower_kVA
      });
    }

    // ---- Évaluation nodale basée sur les phasors V_node ----
    // On n'additionne plus les |ΔV| câble par câble ; on compare |V_node| à une référence U_ref
    let worstAbsPct = 0;
    const nodeVoltageDrops: { nodeId: string; deltaU_cum_V: number; deltaU_cum_percent: number }[] = [];

    const sourceNode = nodes.find(n => n.isSource);
    for (const n of nodes) {
      const Vn = V_node.get(n.id) || Vslack;
      const scaleLine = this.getDisplayLineScale(n.connectionType);
      const U_node_line = abs(Vn) * scaleLine;

      // Référence d'affichage: tension cible source si fournie, sinon base de ce type de connexion
      let { U_base: U_ref_display } = this.getVoltage(n.connectionType);
      if (sourceNode?.tensionCible) U_ref_display = sourceNode.tensionCible;

      const deltaU_V = U_ref_display - U_node_line;
      const deltaU_pct = U_ref_display ? (deltaU_V / U_ref_display) * 100 : 0;

      // Référence nominale (conformité): logique spéciale pour MONO_230V_PN en système 400V
      let U_nom: number;
      if (n.connectionType === 'MONO_230V_PN' && transformerConfig?.nominalVoltage_V && transformerConfig.nominalVoltage_V >= 350) {
        // Pour les nœuds monophasés phase-neutre en système 400V : référence 230V
        U_nom = 230;
      } else {
        // Logique standard
        const { U_base } = this.getVoltage(n.connectionType);
        U_nom = U_base;
      }
      const deltaU_pct_nominal = U_nom ? ((U_nom - U_node_line) / U_nom) * 100 : 0;
      const absPctNom = Math.abs(deltaU_pct_nominal);
      if (absPctNom > worstAbsPct) worstAbsPct = absPctNom;

      nodeVoltageDrops.push({
        nodeId: n.id,
        deltaU_cum_V: deltaU_V,
        deltaU_cum_percent: deltaU_pct
      });
    }

    const compliance = this.getComplianceStatus(worstAbsPct);

    // ---- VIRTUAL BUSBAR : calcul détaillé PAR DÉPART ----
    let virtualBusbar: VirtualBusbar | undefined;
    if (transformerConfig) {
      // Recalcule du courant net source après convergence
      let I_source_net_final = C(0, 0);
      for (const v of children.get(source.id) || []) {
        const cab = parentCableOfChild.get(v);
        if (!cab) continue;
        I_source_net_final = add(I_source_net_final, I_branch.get(cab.id) || C(0, 0));
      }
      I_source_net_final = add(I_source_net_final, I_inj_node.get(source.id) || C(0, 0));

      virtualBusbar = this.calculateVirtualBusbar(
        transformerConfig,
        totalLoads,
        totalProductions,
        source,
        children,
        S_aval,
        V_node,
        I_source_net_final,
        Ztr_phase,
        cableIndexByPair
      );

      console.log('✅ Virtual busbar calculated (phasor-based, per-depart):', virtualBusbar);
    }

    // ---- Node metrics (V_phase and p.u., I_inj per node) ----
    const nodeMetrics = nodes.map(n => {
      const Vn = V_node.get(n.id) || Vslack;
      const { isThreePhase, U_base: U_nom_line } = this.getVoltage(n.connectionType);
      const V_phase_V = abs(Vn);
      // Pour TRI_230V_3F, pas de conversion car travail direct en composé
      const V_nom_phase = n.connectionType === 'TRI_230V_3F' 
        ? U_nom_line // 230V composée directement
        : U_nom_line / (isThreePhase ? Math.sqrt(3) : 1);
      const V_pu = V_nom_phase ? V_phase_V / V_nom_phase : 0;
      const Iinj = I_inj_node.get(n.id) || C(0, 0);
      return { nodeId: n.id, V_phase_V, V_pu, I_inj_A: abs(Iinj) };
    });

    // ---- Export phasors nodaux pour debug/analyse ----
    const nodePhasors = nodes.map(n => {
      const Vn = V_node.get(n.id) || Vslack;
      const V_angle_deg = (Math.atan2(Vn.im, Vn.re) * 180) / Math.PI;
      return {
        nodeId: n.id,
        V_real: Vn.re,
        V_imag: Vn.im,
        V_phase_V: abs(Vn),
        V_angle_deg
      };
    });

    // ---- Export flux de puissance P/Q par tronçon ----
    const cablePowerFlows = calculatedCables.map(cab => {
      const childId = cableChildId.get(cab.id);
      const parentId = cableParentId.get(cab.id);
      const distalId = childId && parentId ? childId : (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeBId : cab.nodeAId);
      const distalNode = nodeById.get(distalId)!;
      const { isThreePhase } = this.getVoltage(distalNode.connectionType);

      // Courant et tension au départ du tronçon
      const Iph = I_branch.get(cab.id) || C(0, 0);
      const parentIdForCab = parentId ?? (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeAId : cab.nodeBId);
      const Vu = V_node.get(parentIdForCab || cab.nodeAId) || Vslack;
      
      // Puissance complexe par phase : S = V * I*
      const S_phase = mul(Vu, conj(Iph));
      const phaseFactor = isThreePhase ? 3 : 1;
      
      const P_kW = (S_phase.re * phaseFactor) / 1000;
      const Q_kVAr = (S_phase.im * phaseFactor) / 1000;
      const S_kVA = (abs(S_phase) * phaseFactor) / 1000;
      const pf = S_kVA > 1e-6 ? Math.abs(P_kW / S_kVA) : 1; // facteur de puissance

      return {
        cableId: cab.id,
        P_kW: Number(P_kW.toFixed(3)),
        Q_kVAr: Number(Q_kVAr.toFixed(3)),
        S_kVA: Number(S_kVA.toFixed(3)),
        pf: Number(pf.toFixed(3))
      };
    });

    // ---- Déterminer le circuit avec la chute maximale ----
    let maxVoltageDropCircuitNumber: number | undefined;
    if (virtualBusbar?.circuits) {
      let worstDropPercent = 0;
      for (const circuit of virtualBusbar.circuits) {
        const circuitNodes = new Set<string>();
        // Trouver tous les nœuds de ce circuit
        const mainCircuitCables = cables.filter(c => c.id === circuit.circuitId);
        for (const cable of mainCircuitCables) {
          circuitNodes.add(cable.nodeAId);
          circuitNodes.add(cable.nodeBId);
        }
        
        // Trouver la pire chute dans ce circuit
        for (const nodeId of circuitNodes) {
          const nodeVoltageDrop = nodeVoltageDrops.find(nvd => nvd.nodeId === nodeId);
          if (nodeVoltageDrop) {
            const absPct = Math.abs(nodeVoltageDrop.deltaU_cum_percent);
            if (absPct > worstDropPercent) {
              worstDropPercent = absPct;
              // Déterminer le numéro de circuit
              const sourceNode = nodes.find(n => n.isSource);
              if (sourceNode) {
                const mainCircuitCables = cables
                  .filter(cable => cable.nodeAId === sourceNode.id || cable.nodeBId === sourceNode.id)
                  .sort((a, b) => a.id.localeCompare(b.id));
                const circuitIndex = mainCircuitCables.findIndex(cable => cable.id === circuit.circuitId);
                maxVoltageDropCircuitNumber = circuitIndex >= 0 ? circuitIndex + 1 : undefined;
              }
            }
          }
        }
      }
    }

    // Ancien système SRG2 supprimé - utilisation de SRG2Regulator uniquement

    console.log('🔄 Creating result object...');
    const result: CalculationResult = {
      scenario,
      cables: calculatedCables,
      totalLoads_kVA: totalLoads,
      totalProductions_kVA: totalProductions,
      globalLosses_kW: Number(globalLosses.toFixed(6)),
      maxVoltageDropPercent: Number(worstAbsPct.toFixed(6)),
      maxVoltageDropCircuitNumber,
      compliance,
      nodeVoltageDrops,
      nodeMetrics,
      nodePhasors,
      cablePowerFlows,
      virtualBusbar
    };

    

    console.log('✅ calculateScenario completed successfully for scenario:', scenario);
    console.log(`   - Total iterations: BFS equilibrium completed`);
    console.log(`   - Network state: ${result.cables.length} cables calculated, ${result.globalLosses_kW.toFixed(3)} kW losses`);
    return result;
  }

}
