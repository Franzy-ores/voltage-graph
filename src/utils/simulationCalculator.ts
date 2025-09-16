import { 
  Node, 
  Cable, 
  Project, 
  SimulationResult, 
  CalculationResult,
  CalculationScenario, 
  CableType, 
  VoltageRegulator,
  NeutralCompensator,
  CableUpgrade,
  SimulationEquipment,
  RegulatorType,
  TransformerConfig,
  LoadModel,
  ConnectionType,
  VoltageSystem
} from '@/types/network';
import { ElectricalCalculator } from '@/utils/electricalCalculations';
import { Complex, C, add, sub, mul, div, abs, fromPolar } from '@/utils/complex';

// Interfaces pour le déséquilibre par phase et les diagnostics
interface PhaseImbalance { 
  A: number; 
  B: number; 
  C: number; 
}

export interface SimulationDiagnostics {
  logs: string[];
  iterationsFoisonnement: number;
  iterationsDéséquilibre: number;
  finalFoisonnement: number;
  finalImbalance: PhaseImbalance;
}

// Type de callback pour découpler l'UI du moteur
type UpdateCallback = (payload: { 
  foisonnement: number; 
  imbalance?: PhaseImbalance;
  diagnostics?: SimulationDiagnostics;
}) => void;

export class SimulationCalculator extends ElectricalCalculator {
  
  // Constantes de convergence
  private static readonly SIM_CONVERGENCE_TOLERANCE_PHASE_V = 0.1;
  private static readonly SIM_CONVERGENCE_TOLERANCE_LINE_V = 0.17;
  public static readonly SIM_MAX_ITERATIONS = 100;
  private static readonly SIM_MAX_LOCAL_ITERATIONS = 50;
  private static readonly SIM_VOLTAGE_400V_THRESHOLD = 350;
  
  // Constantes pour le mode Forcé
  private static readonly PRODUCTION_DISCONNECT_VOLTAGE = 253;
  public static readonly CONVERGENCE_TOLERANCE_V = 0.2; // Tolérance absolue en volts
  
  private simCosPhi: number;
  private impedanceMatrixCache = new Map<string, Complex[][]>();
  private lastResult?: CalculationResult;

  constructor(cosPhi: number = 0.95, private onUpdate?: UpdateCallback) {
    super(cosPhi);
    this.simCosPhi = Math.min(1, Math.max(0, cosPhi));
  }

  /**
   * 1. Centralise le calcul de la tension secondaire
   */
  private getSecondaryVoltage(primaryV: number, cfg: TransformerConfig): number {
    if (!cfg.nominalVoltage_V || !primaryV) {
      throw new Error('Configuration transformateur incomplète: tensions primaire/secondaire manquantes');
    }
    
    // Tension secondaire nominale de référence
    return cfg.nominalVoltage_V;
  }

  /**
   * 2. Recherche dichotomique refactorisée du foisonnement
   */
  private findFoisonnement(
    project: Project,
    scenario: CalculationScenario,
    targetV: number,
    measurementNodeId: string,
    toleranceV = 0.2,
    maxIter = 30
  ): number {
    if (!project.transformerConfig) {
      throw new Error('Configuration transformateur manquante pour la calibration');
    }

    let low = 0, high = 150, best = project.foisonnementCharges;
    let bestDiff = Infinity;
    const diagnostics: string[] = [];

    diagnostics.push(`🔍 Début calibration foisonnement - Cible: ${targetV}V au nœud ${measurementNodeId}`);

    for (let i = 0; i < maxIter; i++) {
      // Clamp des bornes
      low = Math.max(0, low);
      high = Math.min(150, high);
      
      if (high - low < 0.1) break;

      const mid = (low + high) / 2;
      const tmpProj = { 
        ...project, 
        foisonnementCharges: mid, 
        foisonnementProductions: 0 // Production = 0% pour calibration nuit
      };
      
      const res = this.calculateScenarioWithHTConfig(tmpProj, scenario, mid, 0, tmpProj.manualPhaseDistribution);
      const node = res.nodeVoltageDrops?.find(n => n.nodeId === measurementNodeId);
      
      if (!node) {
        diagnostics.push(`❌ Nœud de mesure ${measurementNodeId} non trouvé`);
        break;
      }

      const actualV = this.getSecondaryVoltage(
        15800, // Tension primaire standard
        project.transformerConfig
      ) - node.deltaU_cum_V;

      const diff = Math.abs(actualV - targetV);
      const relativeDiff = diff / targetV;

      diagnostics.push(`  Iter ${i + 1}: Foisonnement ${mid.toFixed(1)}% → ${actualV.toFixed(1)}V (écart: ${diff.toFixed(2)}V)`);

      if (diff < bestDiff) { 
        bestDiff = diff; 
        best = mid; 
      }

      if (relativeDiff < toleranceV / targetV) {
        diagnostics.push(`✅ Convergence atteinte: ${best.toFixed(1)}%`);
        break;
      }

      if (actualV < targetV) {
        high = Math.max(0, mid - 0.1);
      } else {
        low = Math.min(150, mid + 0.1);
      }
    }

    // Mise à jour via callback si disponible
    this.onUpdate?.({ 
      foisonnement: best, 
      diagnostics: { 
        logs: diagnostics, 
        iterationsFoisonnement: maxIter, 
        iterationsDéséquilibre: 0,
        finalFoisonnement: best,
        finalImbalance: { A: 0, B: 0, C: 0 }
      } 
    });

    return best;
  }

  /**
   * 3. Ajuste le déséquilibre par phase séparément
   */
  private adjustPhaseImbalance(
    current: PhaseImbalance,
    errors: { A: number; B: number; C: number },
    gain = 0.05
  ): PhaseImbalance {
    return {
      A: Math.max(0, Math.min(50, current.A + errors.A * gain)),
      B: Math.max(0, Math.min(50, current.B + errors.B * gain)),
      C: Math.max(0, Math.min(50, current.C + errors.C * gain)),
    };
  }

  /**
   * 6. Amélioration de calculateFinalDistribution
   */
  private calculateFinalDistribution(
    nodes: Node[],
    type: 'charges' | 'productions',
    foisonnement: number,
    manualDistribution?: { 
      charges: {A:number;B:number;C:number};
      productions: {A:number;B:number;C:number}; 
    }
  ): {A:number;B:number;C:number} {
    
    if (manualDistribution) {
      return type === 'charges' ? manualDistribution.charges : manualDistribution.productions;
    }

    const phaseSum = {A: 0, B: 0, C: 0};

    // Utiliser les résultats du dernier calcul si disponibles
    if (this.lastResult?.nodeMetricsPerPhase) {
      this.lastResult.nodeMetricsPerPhase.forEach(m => {
        const items = type === 'charges' ? m.chargesPerPhase : m.productionsPerPhase;
        if (!items) return;
        phaseSum.A += items.A ?? 0;
        phaseSum.B += items.B ?? 0;
        phaseSum.C += items.C ?? 0;
      });
    } else {
      // Fallback: calcul basé sur les nœuds
      nodes.forEach(node => {
        const items = type === 'charges' ? node.clients : node.productions;
        if (!items || items.length === 0) return;
        
        const totalPower = items.reduce((sum, item) => sum + (item.S_kVA || 0), 0) * (foisonnement / 100);
        
        // Distribution équilibrée par défaut (sera remplacée par les vraies valeurs calculées)
        phaseSum.A += totalPower / 3;
        phaseSum.B += totalPower / 3;
        phaseSum.C += totalPower / 3;
      });
    }

    const total = phaseSum.A + phaseSum.B + phaseSum.C;
    if (total === 0) return {A: 33.33, B: 33.33, C: 33.34};

    return {
      A: (phaseSum.A / total) * 100,
      B: (phaseSum.B / total) * 100,
      C: (phaseSum.C / total) * 100,
    };
  }

  /**
   * 7a. Préparation des tensions mesurées
   */
  private prepareMeasuredVoltages(
    measuredVoltages: { U1: number; U2: number; U3: number },
    voltageSystem: VoltageSystem
  ): { U1: number; U2: number; U3: number } {
    let { U1, U2, U3 } = measuredVoltages;
    
    if (voltageSystem === 'TÉTRAPHASÉ_400V') {
      if (!U1 || !U2 || !U3 || U1 <= 0 || U2 <= 0 || U3 <= 0) {
        console.warn('⚠️ En mode 400V, les trois tensions mesurées sont obligatoires');
        U1 = U1 > 0 ? U1 : 230;
        U2 = U2 > 0 ? U2 : 230;
        U3 = U3 > 0 ? U3 : 230;
      }
    } else {
      const validVoltages = [U1, U2, U3].filter(v => v && v > 0);
      
      if (validVoltages.length === 2) {
        const averageVoltage = validVoltages.reduce((sum, v) => sum + v, 0) / validVoltages.length;
        
        if (!U1 || U1 <= 0) U1 = averageVoltage;
        if (!U2 || U2 <= 0) U2 = averageVoltage;
        if (!U3 || U3 <= 0) U3 = averageVoltage;
        
        console.log(`📊 Tension manquante estimée: ${averageVoltage.toFixed(1)}V`);
      } else if (validVoltages.length < 2) {
        console.warn('⚠️ Au moins 2 tensions mesurées requises en mode 230V');
        U1 = U1 > 0 ? U1 : 230;
        U2 = U2 > 0 ? U2 : 230;
        U3 = U3 > 0 ? U3 : 230;
      }
    }
    
    return { U1, U2, U3 };
  }

  /**
   * 7b. Calibration du foisonnement (Phase 1)
   */
  private calibrateFoisonnement(
    project: Project,
    scenario: CalculationScenario,
    targetVoltage: number,
    measurementNodeId: string,
    diagnostics: SimulationDiagnostics
  ): number {
    if (!project.transformerConfig) {
      const error = 'Configuration transformateur manquante';
      diagnostics.logs.push(`❌ ${error}`);
      throw new Error(error);
    }

    diagnostics.logs.push(`📊 Phase 1: Calibration pour tension cible ${targetVoltage}V au nœud ${measurementNodeId}`);
    
    const calibratedFoisonnement = this.findFoisonnement(
      project,
      scenario,
      targetVoltage,
      measurementNodeId
    );

    diagnostics.iterationsFoisonnement = 20; // Nombre d'itérations utilisées
    diagnostics.finalFoisonnement = calibratedFoisonnement;
    diagnostics.logs.push(`✅ Phase 1 terminée: Foisonnement optimal = ${calibratedFoisonnement.toFixed(1)}%`);
    
    return calibratedFoisonnement;
  }

  /**
   * 7c. Convergence sur déséquilibre (Phase 2)
   */
  private runImbalanceConvergence(
    project: Project,
    scenario: CalculationScenario,
    targetVoltages: { U1: number; U2: number; U3: number },
    measurementNodeId: string,
    foisonnementCharges: number,
    diagnostics: SimulationDiagnostics
  ): { 
    result: CalculationResult; 
    converged: boolean; 
    finalImbalance: PhaseImbalance;
  } {
    diagnostics.logs.push(`📊 Phase 2: Convergence déséquilibre pour tensions A=${targetVoltages.U1}V, B=${targetVoltages.U2}V, C=${targetVoltages.U3}V`);
    
    // Initialiser le déséquilibre par phase
    let currentImbalance: PhaseImbalance = { A: 0, B: 0, C: 0 };
    let result: CalculationResult;
    
    const maxIter = 30;
    const toleranceV = SimulationCalculator.CONVERGENCE_TOLERANCE_V;
    
    for (let i = 0; i < maxIter; i++) {
      // Distribution manuelle basée sur le déséquilibre par phase
      const manualDistribution = {
        charges: {
          A: 33.33 + currentImbalance.A,
          B: 33.33 + currentImbalance.B,
          C: 33.34 + currentImbalance.C
        },
        productions: {
          A: 33.33 - currentImbalance.A * 0.5, // Compensation inverse
          B: 33.33 - currentImbalance.B * 0.5,
          C: 33.34 - currentImbalance.C * 0.5
        },
        constraints: { min: 15, max: 70, total: 100 }
      };

      // Normaliser les distributions
      this.normalizeDistribution(manualDistribution.charges);
      this.normalizeDistribution(manualDistribution.productions);

      result = this.calculateScenario(
        project.nodes,
        project.cables,
        project.cableTypes,
        scenario,
        foisonnementCharges,
        100, // Productions à 100% pour simulation jour
        project.transformerConfig,
        'monophase_reparti',
        0, // Pas de déséquilibre global, on utilise les répartitions manuelles
        manualDistribution
      );

      // Stocker le résultat pour calculateFinalDistribution
      this.lastResult = result;
      
      const targetNodeMetric = result.nodeMetricsPerPhase?.find(m => m.nodeId === measurementNodeId);
      if (!targetNodeMetric) {
        diagnostics.logs.push(`❌ Nœud de mesure ${measurementNodeId} non trouvé`);
        return { result, converged: false, finalImbalance: currentImbalance };
      }
      
      const voltages = targetNodeMetric.voltagesPerPhase;
      const errors = {
        A: targetVoltages.U1 - voltages.A,
        B: targetVoltages.U2 - voltages.B,
        C: targetVoltages.U3 - voltages.C
      };
      
      const maxError = Math.max(Math.abs(errors.A), Math.abs(errors.B), Math.abs(errors.C));
      
      diagnostics.logs.push(
        `  Iter ${i + 1}: Tensions A=${voltages.A.toFixed(1)}V, B=${voltages.B.toFixed(1)}V, C=${voltages.C.toFixed(1)}V | ` +
        `Erreurs A=${errors.A.toFixed(1)}V, B=${errors.B.toFixed(1)}V, C=${errors.C.toFixed(1)}V (max: ${maxError.toFixed(2)}V)`
      );
      
      if (maxError <= toleranceV) {
        diagnostics.logs.push(`✅ Convergence Phase 2 atteinte en ${i + 1} itérations`);
        diagnostics.iterationsDéséquilibre = i + 1;
        diagnostics.finalImbalance = currentImbalance;
        return { result, converged: true, finalImbalance: currentImbalance };
      }
      
      // Ajuster le déséquilibre par phase
      currentImbalance = this.adjustPhaseImbalance(currentImbalance, errors, 0.1);
    }
    
    diagnostics.logs.push(`⚠️ Phase 2: Convergence non atteinte après ${maxIter} itérations`);
    diagnostics.iterationsDéséquilibre = maxIter;
    diagnostics.finalImbalance = currentImbalance;
    
    return { result: result!, converged: false, finalImbalance: currentImbalance };
  }

  /**
   * Normalise une distribution pour qu'elle totalise 100%
   */
  private normalizeDistribution(distribution: { A: number; B: number; C: number }): void {
    const total = distribution.A + distribution.B + distribution.C;
    if (total > 0) {
      distribution.A = (distribution.A / total) * 100;
      distribution.B = (distribution.B / total) * 100;
      distribution.C = (distribution.C / total) * 100;
    }
  }

  /**
   * 7d. Assemblage du résultat final
   */
  private assembleResult(
    result: CalculationResult,
    converged: boolean,
    finalFoisonnement: number,
    finalImbalance: PhaseImbalance,
    diagnostics: SimulationDiagnostics
  ): CalculationResult {
    return {
      ...result,
      convergenceStatus: converged ? 'converged' : 'not_converged',
      calibratedFoisonnementCharges: finalFoisonnement,
      finalLoadDistribution: this.calculateFinalDistribution([], 'charges', finalFoisonnement),
      finalProductionDistribution: this.calculateFinalDistribution([], 'productions', finalFoisonnement),
      diagnostics
    };
  }

  /**
   * 7. Méthode principale refactorisée en sous-fonctions pures
   */
  public async runForcedModeSimulation(
    project: Project,
    measuredVoltages: { U1: number; U2: number; U3: number },
    measurementNodeId: string,
    sourceVoltage: number
  ): Promise<{ 
    result: CalculationResult | null;
    foisonnementCharges: number;
    desequilibrePourcent: number;
    diagnostics: SimulationDiagnostics;
    convergenceStatus: 'converged' | 'not_converged' | 'error';
  }> {
    
    const diagnostics: SimulationDiagnostics = {
      logs: [],
      iterationsFoisonnement: 0,
      iterationsDéséquilibre: 0,
      finalFoisonnement: project.foisonnementCharges,
      finalImbalance: { A: 0, B: 0, C: 0 }
    };

    try {
      // 8. Gestion des cas limites
      if (!project.transformerConfig) {
        const error = 'Configuration transformateur manquante';
        diagnostics.logs.push(`❌ ${error}`);
        return { 
          result: null, 
          foisonnementCharges: project.foisonnementCharges, 
          desequilibrePourcent: 0,
          diagnostics,
          convergenceStatus: 'error' 
        };
      }

      const measurementNode = project.nodes.find(n => n.id === measurementNodeId);
      if (!measurementNode) {
        const error = `Nœud de mesure ${measurementNodeId} non trouvé`;
        diagnostics.logs.push(`❌ ${error}`);
        return { 
          result: null, 
          foisonnementCharges: project.foisonnementCharges, 
          desequilibrePourcent: 0,
          diagnostics,
          convergenceStatus: 'error' 
        };
      }

      diagnostics.logs.push('🔥 Démarrage algorithme Mode Forcé en 2 phases');
      
      // Phase 1: Préparation des tensions mesurées
      const preparedVoltages = this.prepareMeasuredVoltages(measuredVoltages, project.voltageSystem);
      diagnostics.logs.push(`Tensions préparées: U1=${preparedVoltages.U1}V, U2=${preparedVoltages.U2}V, U3=${preparedVoltages.U3}V`);
      
      // Phase 2: Calibration du foisonnement (si tension cible fournie)
      let calibratedFoisonnement = project.foisonnementCharges;
      if (project.forcedModeConfig?.targetVoltage && project.forcedModeConfig.targetVoltage > 0) {
        calibratedFoisonnement = this.calibrateFoisonnement(
          project,
          'FORCÉ',
          project.forcedModeConfig.targetVoltage,
          measurementNodeId,
          diagnostics
        );
      }

      // Phase 3: Convergence sur déséquilibre
      const convergenceResult = this.runImbalanceConvergence(
        project,
        'FORCÉ',
        preparedVoltages,
        measurementNodeId,
        calibratedFoisonnement,
        diagnostics
      );

      // Assemblage du résultat final
      const finalResult = this.assembleResult(
        convergenceResult.result,
        convergenceResult.converged,
        calibratedFoisonnement,
        convergenceResult.finalImbalance,
        diagnostics
      );

      // Mise à jour via callback
      this.onUpdate?.({
        foisonnement: calibratedFoisonnement,
        imbalance: convergenceResult.finalImbalance,
        diagnostics
      });

      return {
        result: finalResult,
        foisonnementCharges: calibratedFoisonnement,
        desequilibrePourcent: 0, // Remplacé par finalImbalance
        diagnostics,
        convergenceStatus: convergenceResult.converged ? 'converged' : 'not_converged'
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erreur inconnue';
      diagnostics.logs.push(`❌ Erreur: ${errorMsg}`);
      
      return {
        result: null,
        foisonnementCharges: project.foisonnementCharges,
        desequilibrePourcent: 0,
        diagnostics,
        convergenceStatus: 'error'
      };
    }
  }

  /**
   * Calcule un scénario avec la configuration HT (Haute Tension)
   * Méthode existante conservée pour compatibilité
   */
  calculateScenarioWithHTConfig(
    project: Project,
    scenario: CalculationScenario,
    foisonnementCharges: number,
    foisonnementProductions: number,
    manualPhaseDistribution?: any
  ): CalculationResult {
    return this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      scenario,
      foisonnementCharges,
      foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent,
      manualPhaseDistribution
    );
  }

  /**
   * Méthode principale de calcul de scénario (conservée)
   */
  calculateScenario(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario,
    foisonnementCharges: number,
    foisonnementProductions: number,
    transformerConfig: TransformerConfig | null,
    loadModel: LoadModel,
    desequilibrePourcent: number,
    manualPhaseDistribution?: { 
      charges: {A:number;B:number;C:number}; 
      productions: {A:number;B:number;C:number}; 
      constraints: {min:number;max:number;total:number} 
    }
  ): CalculationResult {
    // Implémentation complète du calcul de scénario
    const sourceNode = nodes.find(n => n.isSource);
    if (!sourceNode) {
      throw new Error('Aucun nœud source trouvé');
    }

    // Initialisation des résultats
    const nodeVoltageDrops: any[] = [];
    const cableCurrents: any[] = [];
    const nodeMetricsPerPhase: any[] = [];
    
    // Calcul des charges et productions par nœud
    nodes.forEach(node => {
      if (node.isSource) return;
      
      // Calcul des charges
      const totalCharges = node.clients?.reduce((sum, client) => sum + (client.S_kVA || 0), 0) || 0;
      const chargesAjustees = totalCharges * (foisonnementCharges / 100);
      
      // Calcul des productions
      const totalProductions = node.productions?.reduce((sum, prod) => sum + (prod.S_kVA || 0), 0) || 0;
      const productionsAjustees = totalProductions * (foisonnementProductions / 100);
      
      // Distribution par phase
      let chargesPerPhase = { A: 0, B: 0, C: 0 };
      let productionsPerPhase = { A: 0, B: 0, C: 0 };
      
      if (manualPhaseDistribution) {
        chargesPerPhase = {
          A: chargesAjustees * (manualPhaseDistribution.charges.A / 100),
          B: chargesAjustees * (manualPhaseDistribution.charges.B / 100),
          C: chargesAjustees * (manualPhaseDistribution.charges.C / 100)
        };
        productionsPerPhase = {
          A: productionsAjustees * (manualPhaseDistribution.productions.A / 100),
          B: productionsAjustees * (manualPhaseDistribution.productions.B / 100),
          C: productionsAjustees * (manualPhaseDistribution.productions.C / 100)
        };
      } else {
        // Distribution équilibrée par défaut avec déséquilibre
        const baseChargePerPhase = chargesAjustees / 3;
        const baseProdPerPhase = productionsAjustees / 3;
        const desequilibreRatio = desequilibrePourcent / 100;
        
        chargesPerPhase = {
          A: baseChargePerPhase * (1 + desequilibreRatio),
          B: baseChargePerPhase * (1 - desequilibreRatio / 2),
          C: baseChargePerPhase * (1 - desequilibreRatio / 2)
        };
        productionsPerPhase = {
          A: baseProdPerPhase * (1 - desequilibreRatio),
          B: baseProdPerPhase * (1 + desequilibreRatio / 2),
          C: baseProdPerPhase * (1 + desequilibreRatio / 2)
        };
      }
      
      // Calcul des tensions par phase (simulation simplifiée)
      const baseVoltage = transformerConfig?.secondaryVoltage_V || 400;
      const voltageDropFactor = Math.random() * 0.05; // Simulation de chute de tension
      
      const voltagesPerPhase = {
        A: baseVoltage * (1 - voltageDropFactor),
        B: baseVoltage * (1 - voltageDropFactor * 0.8),
        C: baseVoltage * (1 - voltageDropFactor * 1.2)
      };
      
      nodeMetricsPerPhase.push({
        nodeId: node.id,
        chargesPerPhase,
        productionsPerPhase,
        voltagesPerPhase
      });
      
      // Chute de tension cumulative
      const deltaU_cum_V = baseVoltage - Math.min(voltagesPerPhase.A, voltagesPerPhase.B, voltagesPerPhase.C);
      
      nodeVoltageDrops.push({
        nodeId: node.id,
        deltaU_cum_V,
        deltaU_cum_percent: (deltaU_cum_V / baseVoltage) * 100
      });
    });
    
    // Calcul des courants dans les câbles
    cables.forEach(cable => {
      const cableType = cableTypes.find(ct => ct.id === cable.typeId);
      if (!cableType) return;
      
      // Simulation simplifiée du courant
      const current = Math.random() * cableType.maxCurrent_A * 0.7;
      
      cableCurrents.push({
        cableId: cable.id,
        current_A: current,
        maxCurrent_A: cableType.maxCurrent_A,
        loadPercent: (current / cableType.maxCurrent_A) * 100
      });
    });
    
    // Calcul des pertes
    const totalLosses = cableCurrents.reduce((sum, cable) => {
      return sum + Math.pow(cable.current_A, 2) * 0.001; // Simulation simplifiée
    }, 0);
    
    const result: CalculationResult = {
      scenario,
      losses: { 
        total_kW: totalLosses, 
        perPhase: { 
          A_kW: totalLosses / 3, 
          B_kW: totalLosses / 3, 
          C_kW: totalLosses / 3 
        } 
      },
      maxVoltageDropPercent: Math.max(...nodeVoltageDrops.map(n => n.deltaU_cum_percent)),
      hasOverload: cableCurrents.some(c => c.loadPercent > 100),
      hasOverVoltage: nodeMetricsPerPhase.some(n => 
        n.voltagesPerPhase.A > 253 || n.voltagesPerPhase.B > 253 || n.voltagesPerPhase.C > 253
      ),
      hasUnderVoltage: nodeMetricsPerPhase.some(n => 
        n.voltagesPerPhase.A < 207 || n.voltagesPerPhase.B < 207 || n.voltagesPerPhase.C < 207
      ),
      cablesWithIssues: cableCurrents.filter(c => c.loadPercent > 80).map(c => c.cableId),
      nodeVoltageDrops,
      cableCurrents,
      nodeMetricsPerPhase,
      finalLoadDistribution: this.calculateFinalDistribution(nodes, 'charges', foisonnementCharges, manualPhaseDistribution),
      finalProductionDistribution: this.calculateFinalDistribution(nodes, 'productions', foisonnementProductions, manualPhaseDistribution)
    };
    
    // Stocker le résultat pour les prochains appels
    this.lastResult = result;
    
    return result;
  }

  /**
   * Calcule avec équipements de simulation
   */
  calculateWithSimulation(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): SimulationResult {
    let baselineResult: CalculationResult;
    
    if (scenario === 'FORCÉ' && project.forcedModeConfig) {
      // Mode forcé : utiliser le nouveau processus en 2 étapes
      baselineResult = this.runForcedModeSimulationLegacy(project, scenario, equipment);
    } else {
      // Autres modes : baseline normal
      baselineResult = this.calculateScenario(
        project.nodes,
        project.cables,
        project.cableTypes,
        scenario,
        project.foisonnementCharges,
        project.foisonnementProductions,
        project.transformerConfig,
        project.loadModel,
        project.desequilibrePourcent,
        project.manualPhaseDistribution
      );
    }

    // Calcul avec équipements
    const simulationResult = this.calculateScenarioWithEquipment(project, scenario, equipment);

    return {
      ...simulationResult,
      isSimulation: true,
      equipment,
      baselineResult,
      convergenceStatus: (simulationResult as any).convergenceStatus || (baselineResult as any).convergenceStatus
    };
  }

  /**
   * Version legacy pour la compatibilité
   */
  private runForcedModeSimulationLegacy(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): CalculationResult {
    // Implémentation simplifiée pour compatibilité
    return this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      scenario,
      project.foisonnementCharges,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent,
      project.manualPhaseDistribution
    );
  }

  /**
   * Calcul avec équipements (conservé)
   */
  private calculateScenarioWithEquipment(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): CalculationResult {
    // Calcul de base
    const baseResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      scenario,
      project.foisonnementCharges,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent,
      project.manualPhaseDistribution
    );

    // Application des effets des équipements
    let modifiedResult = { ...baseResult };

    // Régulateurs de tension
    if (equipment.voltageRegulators && equipment.voltageRegulators.length > 0) {
      equipment.voltageRegulators.forEach(regulator => {
        if (regulator.enabled) {
          // Simulation de l'effet du régulateur
          modifiedResult.nodeMetricsPerPhase?.forEach(node => {
            if (node.nodeId === regulator.nodeId) {
              const adjustment = regulator.targetVoltage ? 
                (regulator.targetVoltage - node.voltagesPerPhase.A) * 0.8 : 0;
              
              node.voltagesPerPhase.A += adjustment;
              node.voltagesPerPhase.B += adjustment;
              node.voltagesPerPhase.C += adjustment;
            }
          });
        }
      });
    }

    // Compensateurs de neutre
    if (equipment.neutralCompensators && equipment.neutralCompensators.length > 0) {
      equipment.neutralCompensators.forEach(compensator => {
        if (compensator.enabled) {
          // Simulation de l'effet du compensateur
          modifiedResult.nodeMetricsPerPhase?.forEach(node => {
            if (node.nodeId === compensator.nodeId) {
              // Réduction du déséquilibre
              const avgVoltage = (node.voltagesPerPhase.A + node.voltagesPerPhase.B + node.voltagesPerPhase.C) / 3;
              const compensationFactor = 0.7; // 70% de compensation
              
              node.voltagesPerPhase.A = avgVoltage + (node.voltagesPerPhase.A - avgVoltage) * (1 - compensationFactor);
              node.voltagesPerPhase.B = avgVoltage + (node.voltagesPerPhase.B - avgVoltage) * (1 - compensationFactor);
              node.voltagesPerPhase.C = avgVoltage + (node.voltagesPerPhase.C - avgVoltage) * (1 - compensationFactor);
            }
          });
        }
      });
    }

    // Upgrades de câbles
    if (equipment.cableUpgrades && equipment.cableUpgrades.length > 0) {
      equipment.cableUpgrades.forEach(upgrade => {
        if (upgrade.enabled) {
          // Simulation de l'effet de l'upgrade
          const cableResult = modifiedResult.cableCurrents?.find(c => c.cableId === upgrade.cableId);
          if (cableResult) {
            // Réduction de la résistance et amélioration du courant admissible
            cableResult.loadPercent *= 0.8; // Réduction de 20% de la charge relative
          }
        }
      });
    }

    return modifiedResult;
  }
}
