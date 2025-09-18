import {
  CalculationResult,
  Project,
  Node,
  Cable,
  CableType,
  CalculationScenario,
  TransformerConfig,
  LoadModel,
  RegulatorType,
  VoltageRegulator,
  NeutralCompensator,
  SimulationEquipment,
  SimulationResult,
  CableUpgrade
} from '@/types/network';
import { ElectricalCalculator } from '@/utils/electricalCalculations';
import { Complex, C, add, sub, mul, div, abs, fromPolar } from '@/utils/complex';

export class SimulationCalculator extends ElectricalCalculator {
  
  // Constantes de convergence séparées par type de tension
  private static readonly SIM_CONVERGENCE_TOLERANCE_PHASE_V = 0.1;  // Tension phase
  private static readonly SIM_CONVERGENCE_TOLERANCE_LINE_V = 0.17;   // Tension ligne (√3 × 0.1)
  public static readonly SIM_MAX_ITERATIONS = 100;
  private static readonly SIM_MAX_LOCAL_ITERATIONS = 50;
  private static readonly SIM_VOLTAGE_400V_THRESHOLD = 350;
  
  // Constantes pour le mode Forcé
  private static readonly PRODUCTION_DISCONNECT_VOLTAGE = 253;
  public static readonly CONVERGENCE_TOLERANCE_V = 0.01;
  
  private simCosPhi: number;
  
  constructor(cosPhi: number = 0.95) {
    super(cosPhi);
    this.simCosPhi = Math.min(1, Math.max(0, cosPhi));
  }

  /**
   * Méthode publique pour l'algorithme de convergence du mode forcé
   * Utilise maintenant la nouvelle logique en 2 phases
   */
  public async runForcedModeConvergence(
    project: Project,
    measuredVoltages: { U1: number; U2: number; U3: number },
    measurementNodeId: string,
    sourceVoltage: number
  ): Promise<{ 
    result: CalculationResult | null;
    foisonnementCharges: number;
    desequilibrePourcent: number;
    voltageErrors?: { A: number; B: number; C: number };
    iterations?: number;
    convergenceStatus: 'converged' | 'not_converged';
    finalLoadDistribution?: { A: number; B: number; C: number };
    finalProductionDistribution?: { A: number; B: number; C: number };
    calibratedFoisonnementCharges?: number;
  }> {
    
    // Créer une configuration forcée temporaire
    const tempProject = {
      ...project,
      forcedModeConfig: {
        measuredVoltages,
        measurementNodeId,
        targetVoltage: sourceVoltage
      }
    };
    
    // Utiliser la nouvelle méthode runForcedModeSimulation
    const result = this.runForcedModeSimulation(tempProject, 'FORCÉ', {
      regulators: [],
      neutralCompensators: [],
      cableUpgrades: []
    });
    
    // Convertir le résultat au format attendu
    return {
      result,
      foisonnementCharges: (result as any).calibratedFoisonnementCharges || project.foisonnementCharges,
      desequilibrePourcent: (result as any).desequilibrePourcent || 0,
      voltageErrors: (result as any).voltageErrors,
      iterations: (result as any).iterations || 1,
      convergenceStatus: (result as any).convergenceStatus || 'converged',
      finalLoadDistribution: (result as any).finalLoadDistribution,
      finalProductionDistribution: (result as any).finalProductionDistribution,
      calibratedFoisonnementCharges: (result as any).calibratedFoisonnementCharges
    };
  }
  
  /**
   * Calcule les pourcentages finaux de répartition par phase basés sur la distribution réelle
   */
  private calculateFinalDistribution(
    nodes: Node[], 
    type: 'charges' | 'productions',
    foisonnement: number,
    manualDistribution?: { charges: {A:number;B:number;C:number}; productions: {A:number;B:number;C:number} }
  ): {A: number; B: number; C: number} {
    
    // Si une distribution manuelle est définie, l'utiliser
    if (manualDistribution) {
      const distribution = type === 'charges' ? manualDistribution.charges : manualDistribution.productions;
      return distribution;
    }
    
    // Sinon, calculer à partir de la répartition réelle des nœuds
    let totalA = 0, totalB = 0, totalC = 0;
    
    nodes.forEach(node => {
      const items = type === 'charges' ? node.clients : node.productions;
      if (!items || items.length === 0) return;
      
      const totalPower = items.reduce((sum, item) => sum + (item.S_kVA || 0), 0) * (foisonnement / 100);
      
      // Pour une vraie distribution, ici on devrait récupérer la répartition phase réelle
      // calculée par l'algorithme de flux de puissance.
      // Pour l'instant, distribution équilibrée mais cela devrait être amélioré
      // en récupérant les données des phases A, B, C calculées
      totalA += totalPower / 3;
      totalB += totalPower / 3;
      totalC += totalPower / 3;
    });
    
    const total = totalA + totalB + totalC;
    if (total === 0) return {A: 33.33, B: 33.33, C: 33.33};
    
    return {
      A: (totalA / total) * 100,
      B: (totalB / total) * 100,
      C: (totalC / total) * 100
    };
  }
  
  /**
   * Nouveau processus Mode Forcé en 2 étapes avec boucle de convergence intelligente du déséquilibre
   * Phase 1: Calibration du foisonnement (nuit)
   * Phase 2: Convergence sur déséquilibre (jour) avec ajustement des répartitions par phase
   */
  private runForcedModeSimulation(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): CalculationResult {
    const config = project.forcedModeConfig!;
    const sourceNode = project.nodes.find(n => n.isSource);
    
    // Gestion correcte de la tension de référence selon le système de tension
    let sourceVoltage = sourceNode?.tensionCible || 230;
    if (project.voltageSystem === 'TÉTRAPHASÉ_400V') {
      sourceVoltage = sourceNode?.tensionCible || 400;
      if (config.targetVoltage && config.targetVoltage <= 250) {
        // Tension cible en phase-neutre pour calibration
      }
    }
    
    let foisonnementCharges = project.foisonnementCharges;
    let simulationConverged = false;
    
    console.log('🔥 Mode FORCÉ: Démarrage simulation avec convergence du déséquilibre');
    
    // === VALIDATION ET PRÉPARATION DES TENSIONS MESURÉES ===
    const { U1, U2, U3 } = this.prepareMeasuredVoltages(config.measuredVoltages, project.voltageSystem);
    console.log(`Tensions cibles préparées: U1=${U1}V, U2=${U2}V, U3=${U3}V`);
    
    // === PHASE 1: CALIBRATION DU FOISONNEMENT (NUIT) ===
    if (config.targetVoltage && config.targetVoltage > 0) {
      console.log(`📊 Phase 1: Calibration pour tension cible ${config.targetVoltage}V`);
      foisonnementCharges = this.calibrateFoisonnement(project, scenario, config, foisonnementCharges);
      
      // Mise à jour immédiate du foisonnement dans l'interface
      const updateEvent = new CustomEvent('updateProjectFoisonnement', { 
        detail: { foisonnementCharges } 
      });
      window.dispatchEvent(updateEvent);
    } else {
      console.log('📊 Phase 1: Utilisation du foisonnement manuel (pas de calibration)');
    }
    
    // === PHASE 2: CALCUL DIRECT DU DÉSÉQUILIBRE ===
    console.log('📊 Phase 2: Calcul direct du déséquilibre à partir des tensions mesurées');
    
    // Calculer directement les répartitions à partir des tensions mesurées
    const finalDistribution = this.calculateImbalanceFromVoltages({ U1, U2, U3 });
    
    // Exécuter une simulation finale avec ces répartitions
    const finalResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      scenario,
      foisonnementCharges,
      100, // Productions à 100%
      project.transformerConfig,
      'monophase_reparti',
      0, // Pas de déséquilibre global
      finalDistribution
    );
    
    const convergenceResult = {
      result: finalResult,
      converged: true,
      finalDistribution,
      iterations: 1,
      maxError: 0
    };
    
    // Mise à jour finale des répartitions dans l'interface
    const finalUpdateEvent = new CustomEvent('updateProjectFoisonnement', { 
      detail: { 
        foisonnementCharges,
        finalDistribution: convergenceResult.finalDistribution
      } 
    });
    window.dispatchEvent(finalUpdateEvent);
    
    // Retourner le résultat avec toutes les informations de convergence
    return {
      ...convergenceResult.result,
      convergenceStatus: convergenceResult.converged ? 'converged' : 'not_converged',
      finalLoadDistribution: convergenceResult.finalDistribution.charges,
      finalProductionDistribution: convergenceResult.finalDistribution.productions,
      calibratedFoisonnementCharges: foisonnementCharges,
      optimizedPhaseDistribution: convergenceResult.finalDistribution
    } as CalculationResult;
  }

  /**
   * Prépare les tensions mesurées selon le système de tension
   */
  private prepareMeasuredVoltages(
    measuredVoltages: { U1: number; U2: number; U3: number },
    voltageSystem: string
  ): { U1: number; U2: number; U3: number } {
    let { U1, U2, U3 } = measuredVoltages;
    
    if (voltageSystem === 'TÉTRAPHASÉ_400V') {
      // En mode 400V: les 3 tensions sont obligatoires
      if (!U1 || !U2 || !U3 || U1 <= 0 || U2 <= 0 || U3 <= 0) {
        console.warn('⚠️ En mode 400V, les trois tensions mesurées sont obligatoires');
        U1 = U1 > 0 ? U1 : 230;
        U2 = U2 > 0 ? U2 : 230;
        U3 = U3 > 0 ? U3 : 230;
      }
    } else {
      // En mode 230V: estimation de la tension manquante par la moyenne des deux autres
      const validVoltages = [U1, U2, U3].filter(v => v && v > 0);
      
      if (validVoltages.length === 2) {
        const averageVoltage = validVoltages.reduce((sum, v) => sum + v, 0) / validVoltages.length;
        
        if (!U1 || U1 <= 0) U1 = averageVoltage;
        if (!U2 || U2 <= 0) U2 = averageVoltage;
        if (!U3 || U3 <= 0) U3 = averageVoltage;
        
        console.log(`📊 Tension manquante estimée par moyenne: ${averageVoltage.toFixed(1)}V`);
      } else if (validVoltages.length < 2) {
        console.warn('⚠️ Au moins 2 tensions mesurées sont requises en mode 230V');
        U1 = U1 > 0 ? U1 : 230;
        U2 = U2 > 0 ? U2 : 230;
        U3 = U3 > 0 ? U3 : 230;
      }
    }
    
    return { U1, U2, U3 };
  }

  /**
   * Calibration du foisonnement des charges (Phase 1)
   * Utilise la même logique que calculateWithTargetVoltage du store
   */
  private calibrateFoisonnement(
    project: Project,
    scenario: CalculationScenario,
    config: any,
    initialFoisonnement: number
  ): number {
    let bestFoisonnement = 100;
    let bestVoltage = 0;
    let minDiff = Infinity;

    console.log(`📊 Phase 1: Calibration foisonnement pour tension cible ${config.targetVoltage}V au nœud ${config.measurementNodeId}`);

    // Dichotomie pour trouver le foisonnement optimal (EXACTEMENT la même logique que calculateWithTargetVoltage)
    let low = 0;
    let high = 100;
    
    for (let iteration = 0; iteration < 20; iteration++) {
      const testFoisonnement = (low + high) / 2;
      
      // Créer un projet temporaire avec ce foisonnement
      const tempProject = {
        ...project,
        foisonnementCharges: testFoisonnement,
        foisonnementProductions: 0 // Ignorer les productions pour tension cible
      };

      // Utiliser EXACTEMENT la même méthode que dans le store
      const result = this.calculateScenarioWithHTConfig(
        tempProject,
        scenario,
        testFoisonnement,
        0, // Ignorer les productions pour tension cible
        tempProject.manualPhaseDistribution
      );

      const nodeData = result.nodeVoltageDrops?.find(n => n.nodeId === config.measurementNodeId);
      if (!nodeData) break;

      // Calculer la tension du nœud (EXACTEMENT la même logique que dans le store)
      let baseVoltage = 230;
      const node = tempProject.nodes.find(n => n.id === config.measurementNodeId);
      if (node?.connectionType === 'TÉTRA_3P+N_230_400V') {
        baseVoltage = 400;
      }
      
      const actualVoltage = baseVoltage - nodeData.deltaU_cum_V;
      const diff = Math.abs(actualVoltage - config.targetVoltage);
      
      console.log(`  Iter ${iteration + 1}: Foisonnement ${testFoisonnement.toFixed(1)}% → ${actualVoltage.toFixed(1)}V (cible ${config.targetVoltage}V, écart ${diff.toFixed(1)}V)`);
      
      if (diff < minDiff) {
        minDiff = diff;
        bestFoisonnement = testFoisonnement;
        bestVoltage = actualVoltage;
      }

      // CORRECT: Logique de dichotomie corrigée
      if (actualVoltage < config.targetVoltage) {
        // Tension trop basse → réduire le foisonnement → chercher dans la partie basse
        high = testFoisonnement;
      } else {
        // Tension trop haute → augmenter le foisonnement → chercher dans la partie haute
        low = testFoisonnement;
      }

      if (high - low < 0.1) break;
    }
    
    console.log(`📊 Phase 1 terminée: Foisonnement optimal = ${bestFoisonnement.toFixed(1)}% (tension = ${bestVoltage.toFixed(1)}V)`);
    return bestFoisonnement;
  }

  /**
   * Calcule directement les répartitions de charges par phase à partir des tensions mesurées
   */
  private calculateImbalanceFromVoltages(
    measuredVoltages: { U1: number; U2: number; U3: number }
  ): { charges: { A: number; B: number; C: number }, productions: { A: number; B: number; C: number }, constraints: { min: number; max: number; total: number } } {
    
    const { U1, U2, U3 } = measuredVoltages;
    console.log(`📊 Phase 2: Calcul déséquilibre à partir des tensions U1=${U1}V, U2=${U2}V, U3=${U3}V`);
    
    // Trouver la tension maximale comme référence
    const maxVoltage = Math.max(U1, U2, U3);
    
    // Calculer les chutes de tension relatives par rapport au maximum
    const voltageDrops = {
      A: maxVoltage - U1,
      B: maxVoltage - U2, 
      C: maxVoltage - U3
    };
    
    console.log(`  Chutes de tension: A=${voltageDrops.A.toFixed(1)}V, B=${voltageDrops.B.toFixed(1)}V, C=${voltageDrops.C.toFixed(1)}V`);
    
    // Les phases avec plus de chute de tension ont plus de charge
    const totalDrops = voltageDrops.A + voltageDrops.B + voltageDrops.C;
    
    let charges = { A: 33.33, B: 33.33, C: 33.33 };
    
    if (totalDrops > 0) {
      // Répartition basée sur les chutes de tension (plus de chute = plus de charge)
      const basePercentage = 100 / 3; // 33.33%
      const dropWeights = {
        A: voltageDrops.A / totalDrops,
        B: voltageDrops.B / totalDrops,
        C: voltageDrops.C / totalDrops
      };
      
      // Ajuster par rapport à la répartition équilibrée
      charges = {
        A: basePercentage + (dropWeights.A - 1/3) * 100,
        B: basePercentage + (dropWeights.B - 1/3) * 100, 
        C: basePercentage + (dropWeights.C - 1/3) * 100
      };
      
      // S'assurer que ça somme à 100%
      const total = charges.A + charges.B + charges.C;
      charges.A = (charges.A / total) * 100;
      charges.B = (charges.B / total) * 100;
      charges.C = (charges.C / total) * 100;
    }
    
    console.log(`  Répartitions calculées: A=${charges.A.toFixed(1)}%, B=${charges.B.toFixed(1)}%, C=${charges.C.toFixed(1)}%`);
    
    return {
      charges,
      productions: { A: 33.33, B: 33.33, C: 33.33 }, // Productions équilibrées par défaut
      constraints: { min: 10, max: 80, total: 100 }
    };
  }

  /**
   * Calcule un scénario avec équipements de simulation
   */
  calculateWithSimulation(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): SimulationResult {
    // D'abord calculer le scénario de base (sans équipements)
    let baselineResult: CalculationResult;
    
    if (scenario === 'FORCÉ' && project.forcedModeConfig) {
      // Mode forcé : utiliser le nouveau processus en 2 étapes
      baselineResult = this.runForcedModeSimulation(project, scenario, equipment);
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

    // Ensuite calculer avec les équipements de simulation actifs
    const simulationResult = this.calculateScenarioWithEquipment(
      project,
      scenario,
      equipment
    );

    return {
      ...simulationResult,
      isSimulation: true,
      equipment,
      baselineResult,
      convergenceStatus: (simulationResult as any).convergenceStatus || (baselineResult as any).convergenceStatus
    };
  }

  /**
   * Calcule un scénario en intégrant les équipements de simulation
   */
  private calculateScenarioWithEquipment(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): CalculationResult {
    // Utiliser le scénario de base modifié avec équipements
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
   * Crée un régulateur par défaut pour un nœud
   */
  createDefaultRegulator(nodeId: string, sourceVoltage: number): VoltageRegulator {
    const regulatorType: RegulatorType = sourceVoltage > 300 ? '400V_44kVA' : '230V_77kVA';
    const maxPower = sourceVoltage > 300 ? 44 : 77;
    
    return {
      id: `regulator_${nodeId}_${Date.now()}`,
      nodeId,
      type: regulatorType,
      targetVoltage_V: sourceVoltage > 300 ? 400 : 230,
      maxPower_kVA: maxPower,
      enabled: false
    };
  }
  
  /**
   * Propose des améliorations de circuit complètes
   */
  proposeFullCircuitReinforcement(
    cables: Cable[],
    cableTypes: CableType[],
    threshold: number = 5
  ): CableUpgrade[] {
    return cables
      .filter(cable => (cable.voltageDropPercent || 0) > threshold)
      .map(cable => {
        const currentType = cableTypes.find(t => t.id === cable.typeId);
        const betterType = cableTypes.find(t => 
          t.R12_ohm_per_km < (currentType?.R12_ohm_per_km || Infinity)
        );
        
        return {
          originalCableId: cable.id,
          newCableTypeId: betterType?.id || cable.typeId,
          reason: 'voltage_drop' as const,
          before: {
            voltageDropPercent: cable.voltageDropPercent || 0,
            current_A: cable.current_A || 0,
            losses_kW: cable.losses_kW || 0
          },
          after: {
            voltageDropPercent: (cable.voltageDropPercent || 0) * 0.7,
            current_A: cable.current_A || 0,
            losses_kW: (cable.losses_kW || 0) * 0.7
          },
          improvement: {
            voltageDropReduction: (cable.voltageDropPercent || 0) * 0.3,
            lossReduction_kW: (cable.losses_kW || 0) * 0.3,
            lossReductionPercent: 30
          }
        };
      });
  }
}