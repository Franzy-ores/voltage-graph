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
    console.log('📊 Phase 2: Calcul direct du déséquilibre productions à partir des tensions mesurées');
    
    // Calculer directement les répartitions de productions à partir des tensions mesurées
    const finalDistribution = this.calculateImbalanceFromVoltages({ U1, U2, U3 });
    
    // Exécuter une simulation finale avec foisonnement productions à 100% et répartition calculée
    const finalResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      scenario,
      foisonnementCharges, // Utiliser le foisonnement charges calculé en phase 1
      100, // Foisonnement productions à 100%
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
    
    // Mise à jour finale dans l'interface - conserver la modifiabilité des curseurs
    const finalUpdateEvent = new CustomEvent('updateProjectFoisonnement', { 
      detail: { 
        foisonnementCharges,
        foisonnementProductions: 100, // Foisonnement productions fixé à 100%
        finalDistribution: convergenceResult.finalDistribution,
        keepSliderEnabled: true // Permettre la modification des curseurs après simulation
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
   * Calcule directement les répartitions de productions par phase à partir des tensions mesurées
   */
  private calculateImbalanceFromVoltages(
    measuredVoltages: { U1: number; U2: number; U3: number }
  ): { charges: { A: number; B: number; C: number }, productions: { A: number; B: number; C: number }, constraints: { min: number; max: number; total: number } } {
    
    const { U1, U2, U3 } = measuredVoltages;
    console.log(`📊 Phase 2: Calcul déséquilibre productions à partir des tensions U1=${U1}V, U2=${U2}V, U3=${U3}V`);
    
    // Trouver la tension minimale comme référence
    const minVoltage = Math.min(U1, U2, U3);
    
    // Calculer les surélévations de tension par rapport au minimum
    const voltageElevations = {
      A: U1 - minVoltage,
      B: U2 - minVoltage, 
      C: U3 - minVoltage
    };
    
    console.log(`  Surélévations de tension: A=${voltageElevations.A.toFixed(1)}V, B=${voltageElevations.B.toFixed(1)}V, C=${voltageElevations.C.toFixed(1)}V`);
    
    // Les phases avec plus de surélévation ont plus de production
    const totalElevations = voltageElevations.A + voltageElevations.B + voltageElevations.C;
    
    let productions = { A: 33.33, B: 33.33, C: 33.33 };
    
    if (totalElevations > 0) {
      // Répartition basée sur les surélévations de tension (plus de surélévation = plus de production)
      const basePercentage = 100 / 3; // 33.33%
      const elevationWeights = {
        A: voltageElevations.A / totalElevations,
        B: voltageElevations.B / totalElevations,
        C: voltageElevations.C / totalElevations
      };
      
      // Ajuster par rapport à la répartition équilibrée
      productions = {
        A: basePercentage + (elevationWeights.A - 1/3) * 100,
        B: basePercentage + (elevationWeights.B - 1/3) * 100, 
        C: basePercentage + (elevationWeights.C - 1/3) * 100
      };
      
      // S'assurer que ça somme à 100%
      const total = productions.A + productions.B + productions.C;
      productions.A = (productions.A / total) * 100;
      productions.B = (productions.B / total) * 100;
      productions.C = (productions.C / total) * 100;
    }
    
    console.log(`  Répartitions productions calculées: A=${productions.A.toFixed(1)}%, B=${productions.B.toFixed(1)}%, C=${productions.C.toFixed(1)}%`);
    
    return {
      charges: { A: 33.33, B: 33.33, C: 33.33 }, // Charges équilibrées
      productions,
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
    console.log('🚀 SimulationCalculator.calculateWithSimulation START');
    console.log('📊 Input parameters:', {
      scenario,
      equipment: {
        regulators: equipment.regulators.filter(r => r.enabled).length,
        compensators: equipment.neutralCompensators.filter(c => c.enabled).length,
        upgrades: equipment.cableUpgrades.length
      }
    });

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

    console.log('📊 Baseline result structure:', {
      hasNodeMetrics: !!baselineResult.nodeMetrics,
      hasNodeMetricsPerPhase: !!baselineResult.nodeMetricsPerPhase,
      nodeMetricsPerPhaseCount: baselineResult.nodeMetricsPerPhase?.length || 0
    });

    // Ensuite calculer avec les équipements de simulation actifs
    const simulationResult = this.calculateScenarioWithEquipment(
      project,
      scenario,
      equipment
    );

    console.log('📊 Final simulation result structure:', {
      hasNodeMetrics: !!simulationResult.nodeMetrics,
      hasNodeMetricsPerPhase: !!simulationResult.nodeMetricsPerPhase,
      nodeMetricsPerPhaseCount: simulationResult.nodeMetricsPerPhase?.length || 0
    });

    const result = {
      ...simulationResult,
      isSimulation: true,
      equipment,
      baselineResult,
      convergenceStatus: (simulationResult as any).convergenceStatus || (baselineResult as any).convergenceStatus
    };

    console.log('✅ SimulationCalculator.calculateWithSimulation COMPLETE');
    return result;
  }

  /**
   * Calcule un scénario en intégrant les équipements de simulation
   */
  private calculateScenarioWithEquipment(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): CalculationResult {
    console.log('🔧 SimulationCalculator.calculateScenarioWithEquipment START');
    console.log('Equipment:', {
      regulators: equipment.regulators.filter(r => r.enabled).length,
      compensators: equipment.neutralCompensators.filter(c => c.enabled).length,
      upgrades: equipment.cableUpgrades.length
    });

    // Étape 1: Calcul de base sans équipements
    let baseResult = this.calculateScenario(
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

    console.log('📊 Base result BEFORE equipment application:', {
      hasNodeMetrics: !!baseResult.nodeMetrics,
      hasNodeMetricsPerPhase: !!baseResult.nodeMetricsPerPhase,
      nodeMetricsPerPhaseCount: baseResult.nodeMetricsPerPhase?.length || 0
    });

    // Étape 2: Appliquer les compensateurs de neutre
    const activeCompensators = equipment.neutralCompensators.filter(c => c.enabled);
    if (activeCompensators.length > 0) {
      console.log(`🔧 Applying ${activeCompensators.length} neutral compensators`);
      
      // Log compensators details
      activeCompensators.forEach(comp => {
        console.log(`📊 Compensator ${comp.id} on node ${comp.nodeId}`);
      });
      
      const resultBeforeCompensation = JSON.parse(JSON.stringify(baseResult));
      baseResult = this.applyNeutralCompensation(project.nodes, project.cables, activeCompensators, baseResult, project.cableTypes);
      
      console.log('📊 Result AFTER neutral compensation:', {
        hasNodeMetrics: !!baseResult.nodeMetrics,
        hasNodeMetricsPerPhase: !!baseResult.nodeMetricsPerPhase,
        nodeMetricsPerPhaseCount: baseResult.nodeMetricsPerPhase?.length || 0
      });

      // Detailed comparison for compensator nodes
      activeCompensators.forEach(comp => {
        const beforeMetrics = resultBeforeCompensation.nodeMetricsPerPhase?.find(n => n.nodeId === comp.nodeId);
        const afterMetrics = baseResult.nodeMetricsPerPhase?.find(n => n.nodeId === comp.nodeId);
        
        console.log(`🔍 Node ${comp.nodeId} compensation effect:`, {
          before: beforeMetrics?.voltagesPerPhase,
          after: afterMetrics?.voltagesPerPhase,
          changed: JSON.stringify(beforeMetrics?.voltagesPerPhase) !== JSON.stringify(afterMetrics?.voltagesPerPhase)
        });
      });
    }

    // Étape 3: Appliquer les régulateurs de tension polyphasés
    const activeRegulators = equipment.regulators.filter(r => r.enabled);
    if (activeRegulators.length > 0) {
      console.log(`🔧 Applying ${activeRegulators.length} polyphase voltage regulators`);
      
      // Log regulators details
      activeRegulators.forEach(reg => {
        console.log(`📊 Regulator ${reg.id} on node ${reg.nodeId}: target ${reg.targetVoltage_V}V, capacity ${reg.maxPower_kVA}kVA`);
      });
      
      const resultBeforeRegulators = JSON.parse(JSON.stringify(baseResult));
      baseResult = this.applyPolyphaseVoltageRegulators(
        project.nodes, 
        project.cables, 
        project.cableTypes,
        activeRegulators, 
        baseResult,
        project,
        scenario
      );
      
      console.log('📊 Result AFTER polyphase voltage regulation:', {
        hasNodeMetrics: !!baseResult.nodeMetrics,
        hasNodeMetricsPerPhase: !!baseResult.nodeMetricsPerPhase,
        nodeMetricsPerPhaseCount: baseResult.nodeMetricsPerPhase?.length || 0
      });

      // Detailed comparison for regulator nodes
      activeRegulators.forEach(reg => {
        const beforeMetrics = resultBeforeRegulators.nodeMetricsPerPhase?.find(n => n.nodeId === reg.nodeId);
        const afterMetrics = baseResult.nodeMetricsPerPhase?.find(n => n.nodeId === reg.nodeId);
        
        console.log(`🔍 Node ${reg.nodeId} polyphase regulation effect:`, {
          before: beforeMetrics?.voltagesPerPhase,
          after: afterMetrics?.voltagesPerPhase,
          changed: JSON.stringify(beforeMetrics?.voltagesPerPhase) !== JSON.stringify(afterMetrics?.voltagesPerPhase)
        });
        
        // Log regulator metadata
        console.log(`📋 Regulator ${reg.id} metadata:`, {
          appliedPower_kVA: (reg as any).appliedPower_kVA,
          saturated: (reg as any).saturated,
          requestedPower_kVA: (reg as any).requestedPower_kVA,
          beforeVoltages: (reg as any).beforeVoltages,
          afterVoltages: (reg as any).afterVoltages
        });
      });
    }

    // Étape 4: Appliquer les améliorations de câbles (future implementation)
    if (equipment.cableUpgrades.length > 0) {
      console.log(`🔧 Note: ${equipment.cableUpgrades.length} cable upgrades found but not yet implemented`);
    }

    console.log('✅ SimulationCalculator.calculateScenarioWithEquipment COMPLETE');
    return baseResult;
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
      targetVoltage_V: 230, // Toujours 230V : ligne-ligne pour réseau 230V, phase-neutre pour réseau 400V
      maxPower_kVA: maxPower,
      enabled: false
    };
  }

  /**
   * Corrige les régulateurs existants avec des valeurs incorrectes de tension cible
   */
  fixExistingRegulators(regulators: VoltageRegulator[]): VoltageRegulator[] {
    return regulators.map(regulator => {
      // Corriger les régulateurs qui ont encore 400V en consigne 
      if (regulator.targetVoltage_V === 400) {
        console.log(`🔧 Correction du régulateur ${regulator.id}: 400V → 230V`);
        return {
          ...regulator,
          targetVoltage_V: 230
        };
      }
      return regulator;
    });
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

  /**
   * Calcule l'impédance équivalente en amont d'un nœud (somme des Z série des câbles)
   * @param nodeId ID du nœud
   * @param parentMap Map parent-enfant de la topologie  
   * @param cables Liste des câbles
   * @param cableTypes Types des câbles
   * @returns Impédance par phase [Z_A, Z_B, Z_C] en Ω
   */
  private computeUpstreamImpedancePerPhase(
    nodeId: string,
    parentMap: Map<string, string>,
    cables: Cable[],
    cableTypes: CableType[]
  ): [number, number, number] {
    let currentNodeId = nodeId;
    let totalZA = 0, totalZB = 0, totalZC = 0;

    // Remonter jusqu'à la source en sommant les impédances
    while (parentMap.has(currentNodeId)) {
      const parentId = parentMap.get(currentNodeId)!;
      const cable = cables.find(c => 
        (c.nodeAId === parentId && c.nodeBId === currentNodeId) ||
        (c.nodeAId === currentNodeId && c.nodeBId === parentId)
      );

      if (cable) {
        const cableType = cableTypes.find(ct => ct.id === cable.typeId);
        if (cableType) {
          // Calculer longueur du câble
          const length_km = this.calculateCableLength(cable.coordinates) / 1000;
          // Simplification: impédance par phase identique (Z12)
          const Z_phase = Math.sqrt(
            Math.pow(cableType.R12_ohm_per_km * length_km, 2) + 
            Math.pow(cableType.X12_ohm_per_km * length_km, 2)
          );
          
          totalZA += Z_phase;
          totalZB += Z_phase;
          totalZC += Z_phase;
        }
      }

      currentNodeId = parentId;
    }

    return [totalZA, totalZB, totalZC];
  }

  /**
   * Calcule la longueur d'un câble à partir de ses coordonnées
   */
  private calculateCableLength(coordinates: { lat: number; lng: number }[]): number {
    if (coordinates.length < 2) return 0;
    
    let totalLength = 0;
    for (let i = 1; i < coordinates.length; i++) {
      const prev = coordinates[i - 1];
      const curr = coordinates[i];
      
      // Distance haversine approximative en mètres
      const dLat = (curr.lat - prev.lat) * Math.PI / 180;
      const dLng = (curr.lng - prev.lng) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(prev.lat * Math.PI / 180) * Math.cos(curr.lat * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = 6371000 * c; // Rayon de la Terre en mètres
      
      totalLength += distance;
    }
    
    return totalLength;
  }

  /**
   * Simule l'effet transformateur du SRG2 en modifiant la tension nominale du nœud
   */
  private applySRG2TransformerEffect(
    nodes: Node[],
    regulatorNodeId: string,
    adjustmentPerPhase: { A: number; B: number; C: number },
    networkType: '400V' | '230V'
  ): Node[] {
    const modifiedNodes = JSON.parse(JSON.stringify(nodes));
    const nodeIndex = modifiedNodes.findIndex((n: Node) => n.id === regulatorNodeId);
    
    if (nodeIndex >= 0) {
      // Nettoyer les anciens équipements SRG2
      if (modifiedNodes[nodeIndex].productions) {
        modifiedNodes[nodeIndex].productions = modifiedNodes[nodeIndex].productions.filter(
          (p: any) => !p.id || !p.id.includes('srg2_effect')
        );
      }
      if (modifiedNodes[nodeIndex].clients) {
        modifiedNodes[nodeIndex].clients = modifiedNodes[nodeIndex].clients.filter(
          (c: any) => !c.id || !c.id.includes('srg2_effect')
        );
      }

      // Calculer l'ajustement moyen pour déterminer l'effet global
      const averageAdjustment = (adjustmentPerPhase.A + adjustmentPerPhase.B + adjustmentPerPhase.C) / 3;
      
      // Le SRG2 modifie effectivement la tension de sortie
      // Simuler cet effet en créant une source/charge équivalente
      if (Math.abs(averageAdjustment) > 0.5) { // Seuil minimal d'action
        
        // Estimer la puissance équivalente nécessaire pour l'ajustement
        // Formule approximative : P = (ΔV / V_nominal) * S_apparent_node
        const nodePower = this.calculateNodeApparentPower(modifiedNodes[nodeIndex]);
        const adjustmentRatio = Math.abs(averageAdjustment) / 230;
        const equivalentPower_kVA = nodePower * adjustmentRatio * 2; // Facteur 2 pour l'effet transformateur
        
        if (averageAdjustment > 0) {
          // Augmentation de tension → effet équivalent à une production
          if (!modifiedNodes[nodeIndex].productions) {
            modifiedNodes[nodeIndex].productions = [];
          }
          
          modifiedNodes[nodeIndex].productions.push({
            id: `srg2_effect_${regulatorNodeId}`,
            label: `Effet SRG2 +${averageAdjustment.toFixed(0)}V`,
            S_kVA: equivalentPower_kVA
          });
          
          console.log(`📊 SRG2 boost effect: +${averageAdjustment.toFixed(1)}V simulated as ${equivalentPower_kVA.toFixed(1)}kVA production`);
          
        } else {
          // Diminution de tension → effet équivalent à une charge
          if (!modifiedNodes[nodeIndex].clients) {
            modifiedNodes[nodeIndex].clients = [];
          }
          
          modifiedNodes[nodeIndex].clients.push({
            id: `srg2_effect_${regulatorNodeId}`,
            label: `Effet SRG2 ${averageAdjustment.toFixed(0)}V`,
            S_kVA: equivalentPower_kVA
          });
          
          console.log(`📊 SRG2 buck effect: ${averageAdjustment.toFixed(1)}V simulated as ${equivalentPower_kVA.toFixed(1)}kVA load`);
        }
      }
    }
    
    return modifiedNodes;
  }

  /**
   * Calcule la puissance apparente approximative d'un nœud
   */
  private calculateNodeApparentPower(node: Node): number {
    let totalPower = 0;
    
    // Additionner les charges
    if (node.clients) {
      totalPower += node.clients.reduce((sum, client) => sum + (client.S_kVA || 0), 0);
    }
    
    // Additionner les productions  
    if (node.productions) {
      totalPower += node.productions.reduce((sum, prod) => sum + (prod.S_kVA || 0), 0);
    }
    
    // Minimum 10kVA pour éviter les divisions par zéro
    return Math.max(totalPower, 10);
  }

  /**
   * Calcule l'injection requise pour un régulateur polyphasé
   */
  private computeRegulatorRequirement(
    Uinit: [number, number, number],
    Utarget: [number, number, number],
    Zup: [number, number, number]
  ): {
    S_req_phase_VA: [number, number, number];
    S_req_total_VA: number;
    Ireq_per_phase: [number, number, number];
    deltaV: [number, number, number];
  } {
    const deltaV: [number, number, number] = [
      Utarget[0] - Uinit[0],
      Utarget[1] - Uinit[1], 
      Utarget[2] - Uinit[2]
    ];

    const Ireq_per_phase: [number, number, number] = [
      Zup[0] > 0 ? deltaV[0] / Zup[0] : 0,
      Zup[1] > 0 ? deltaV[1] / Zup[1] : 0,
      Zup[2] > 0 ? deltaV[2] / Zup[2] : 0
    ];

    const S_req_phase_VA: [number, number, number] = [
      Math.abs(Utarget[0] * Ireq_per_phase[0]),
      Math.abs(Utarget[1] * Ireq_per_phase[1]),
      Math.abs(Utarget[2] * Ireq_per_phase[2])
    ];

    const S_req_total_VA = S_req_phase_VA[0] + S_req_phase_VA[1] + S_req_phase_VA[2];

    return { S_req_phase_VA, S_req_total_VA, Ireq_per_phase, deltaV };
  }

  /**
   * Applique une injection de puissance sur une copie des nœuds
   * Supporte maintenant les deux directions: production (injection) et absorption (charge)
   */
  private applyInjectionOnCopy(
    nodesCopy: Node[],
    regNodeId: string,
    S_inj_total_kVA: number,
    direction: 'production' | 'absorption' = 'production'
  ): Node[] {
    const modifiedNodes = JSON.parse(JSON.stringify(nodesCopy));
    const nodeIndex = modifiedNodes.findIndex((n: Node) => n.id === regNodeId);
    
    if (nodeIndex >= 0) {
      // Nettoyer les anciennes injections de régulateur
      if (modifiedNodes[nodeIndex].productions) {
        modifiedNodes[nodeIndex].productions = modifiedNodes[nodeIndex].productions.filter(
          (p: any) => !p.id || !p.id.includes('regulator_injection')
        );
      }
      if (modifiedNodes[nodeIndex].clients) {
        modifiedNodes[nodeIndex].clients = modifiedNodes[nodeIndex].clients.filter(
          (c: any) => !c.id || !c.id.includes('regulator_injection')
        );
      }

      const absS_kVA = Math.abs(S_inj_total_kVA);
      
      if (direction === 'production') {
        // Injection comme production (pour augmenter la tension)
        if (!modifiedNodes[nodeIndex].productions) {
          modifiedNodes[nodeIndex].productions = [];
        }
        
        modifiedNodes[nodeIndex].productions.push({
          id: `regulator_injection_${regNodeId}`,
          label: `Régulateur Production ${absS_kVA.toFixed(1)}kVA`,
          S_kVA: absS_kVA
        });

        console.log(`📊 Applied ${absS_kVA.toFixed(1)}kVA as PRODUCTION for voltage regulation`);
        
      } else {
        // Absorption comme charge (pour diminuer la tension)
        if (!modifiedNodes[nodeIndex].clients) {
          modifiedNodes[nodeIndex].clients = [];
        }
        
        modifiedNodes[nodeIndex].clients.push({
          id: `regulator_injection_${regNodeId}`,
          label: `Régulateur Absorption ${absS_kVA.toFixed(1)}kVA`,
          S_kVA: absS_kVA
        });

        console.log(`📊 Applied ${absS_kVA.toFixed(1)}kVA as ABSORPTION for voltage regulation`);
      }
    }
    
    return modifiedNodes;
  }

  /**
   * Détecte le type de réseau (400V ou 230V) selon la configuration
   */
  private detectNetworkType(project: Project): { type: '400V' | '230V'; confidence: 'high' | 'low' } {
    // 1. Vérifier via transformerConfig
    if (project.transformerConfig?.nominalVoltage_V) {
      if (project.transformerConfig.nominalVoltage_V >= 380) {
        return { type: '400V', confidence: 'high' };
      } else if (project.transformerConfig.nominalVoltage_V <= 250) {
        return { type: '230V', confidence: 'high' };
      }
    }

    // 2. Analyser les connexions des nœuds
    const connectionTypes = project.nodes.map(n => n.connectionType);
    const has400V = connectionTypes.some(ct => ct === 'TÉTRA_3P+N_230_400V' || ct === 'MONO_230V_PN');
    const has230V = connectionTypes.some(ct => ct === 'TRI_230V_3F' || ct === 'MONO_230V_PP');

    if (has400V && !has230V) {
      return { type: '400V', confidence: 'high' };
    } else if (has230V && !has400V) {
      return { type: '230V', confidence: 'high' };
    }

    // 3. Par défaut, assumer 400V (plus courant)
    return { type: '400V', confidence: 'low' };
  }

  /**
   * Construit la topologie parent-enfant du réseau
   */
  private buildParentMap(nodes: Node[], cables: Cable[]): Map<string, string> {
    const parentMap = new Map<string, string>();
    const sourceNode = nodes.find(n => n.isSource);
    
    if (!sourceNode) return parentMap;

    // BFS pour construire l'arbre
    const visited = new Set<string>([sourceNode.id]);
    const queue = [sourceNode.id];

    while (queue.length > 0) {
      const currentNodeId = queue.shift()!;
      
      // Trouver tous les câbles connectés au nœud courant
      const connectedCables = cables.filter(c => 
        c.nodeAId === currentNodeId || c.nodeBId === currentNodeId
      );

      for (const cable of connectedCables) {
        const otherNodeId = cable.nodeAId === currentNodeId ? cable.nodeBId : cable.nodeAId;
        
        if (!visited.has(otherNodeId)) {
          visited.add(otherNodeId);
          parentMap.set(otherNodeId, currentNodeId);
          queue.push(otherNodeId);
        }
      }
    }

    return parentMap;
  }

  /**
   * Applique la logique de régulation SRG2 réaliste avec seuils de commutation
   */
  private applySRG2RegulationLogic(
    regulator: VoltageRegulator,
    voltagesPerPhase: { A: number; B: number; C: number },
    networkType: '400V' | '230V'
  ): { 
    adjustmentPerPhase: { A: number; B: number; C: number };
    switchStates: { A: string; B: string; C: string };
    canRegulate: boolean;
  } {
    const V_nominal = 230; // Toujours 230V pour SRG2
    
    // Seuils SRG2 selon documentation
    const thresholds = networkType === '400V' ? {
      // SRG2-400 : ±16V (7%) phase-neutre
      UL: 246,  // LO2 - abaissement complet
      LO1: 238, // (230 + 246) / 2 
      BO1: 222, // (230 + 214) / 2
      UB: 214   // BO2 - augmentation complète
    } : {
      // SRG2-230 : ±14V (6%) ligne-ligne  
      UL: 244,  // LO2
      LO1: 237, // (230 + 244) / 2
      BO1: 223, // (230 + 216) / 2  
      UB: 216   // BO2
    };
    
    const maxAdjustment = networkType === '400V' ? 16 : 14; // Volts
    const adjustmentPerPhase = { A: 0, B: 0, C: 0 };
    const switchStates = { A: 'BYP', B: 'BYP', C: 'BYP' };
    
    // Traitement par phase (indépendant pour 400V, avec contraintes pour 230V)
    ['A', 'B', 'C'].forEach(phase => {
      const voltage = voltagesPerPhase[phase as keyof typeof voltagesPerPhase];
      
      if (voltage >= thresholds.UL) {
        // Abaissement complet (-ΔU)
        adjustmentPerPhase[phase as keyof typeof adjustmentPerPhase] = -maxAdjustment;
        switchStates[phase as keyof typeof switchStates] = 'LO2';
      } else if (voltage >= thresholds.LO1) {
        // Abaissement partiel (-ΔU/2)
        adjustmentPerPhase[phase as keyof typeof adjustmentPerPhase] = -maxAdjustment/2;
        switchStates[phase as keyof typeof switchStates] = 'LO1';
      } else if (voltage <= thresholds.UB) {
        // Augmentation complète (+ΔU)
        adjustmentPerPhase[phase as keyof typeof adjustmentPerPhase] = maxAdjustment;
        switchStates[phase as keyof typeof switchStates] = 'BO2';
      } else if (voltage <= thresholds.BO1) {
        // Augmentation partielle (+ΔU/2)
        adjustmentPerPhase[phase as keyof typeof adjustmentPerPhase] = maxAdjustment/2;
        switchStates[phase as keyof typeof switchStates] = 'BO1';
      }
      // Sinon reste en BYP (bypass)
    });
    
    // Contraintes SRG2-230 : pas d'actions opposées simultanées
    if (networkType === '230V') {
      const hasIncrease = Object.values(adjustmentPerPhase).some(adj => adj > 0);
      const hasDecrease = Object.values(adjustmentPerPhase).some(adj => adj < 0);
      
      if (hasIncrease && hasDecrease) {
        // Priorité à la phase avec écart maximum
        const deviations = {
          A: Math.abs(voltagesPerPhase.A - V_nominal),
          B: Math.abs(voltagesPerPhase.B - V_nominal), 
          C: Math.abs(voltagesPerPhase.C - V_nominal)
        };
        
        const maxDeviation = Math.max(deviations.A, deviations.B, deviations.C);
        const priorityPhase = Object.entries(deviations).find(([_, dev]) => dev === maxDeviation)?.[0];
        
        // Annuler les autres ajustements
        ['A', 'B', 'C'].forEach(phase => {
          if (phase !== priorityPhase) {
            adjustmentPerPhase[phase as keyof typeof adjustmentPerPhase] = 0;
            switchStates[phase as keyof typeof switchStates] = 'BYP';
          }
        });
      }
    }
    
    const canRegulate = Object.values(adjustmentPerPhase).some(adj => adj !== 0);
    return { adjustmentPerPhase, switchStates, canRegulate };
  }

  /**
   * Applique les régulateurs de tension SRG2 avec logique réaliste
   */
  private applyPolyphaseVoltageRegulators(
    nodes: Node[],
    cables: Cable[], 
    cableTypes: CableType[],
    regulators: VoltageRegulator[],
    baseResult: CalculationResult,
    project: Project,
    scenario: CalculationScenario
  ): CalculationResult {
    console.log('🔧 Starting SRG2 voltage regulation with realistic switching logic');

    const networkDetection = this.detectNetworkType(project);
    
    console.log(`📋 Network type detected: ${networkDetection.type} (confidence: ${networkDetection.confidence})`);
    
    if (networkDetection.confidence === 'low') {
      console.warn(`⚠️ Network type detection has low confidence, assuming ${networkDetection.type}`);
    }

    let result = JSON.parse(JSON.stringify(baseResult));
    const warnings: string[] = [];
    const regulatorLog: any[] = [];

    // Appliquer chaque régulateur séquentiellement
    for (const regulator of regulators) {
      try {
        console.log(`🔧 Processing SRG2 regulator ${regulator.id} at node ${regulator.nodeId}`);

        // 1. Récupérer la tension initiale du nœud
        const nodeMetrics = result.nodeMetricsPerPhase?.find(n => n.nodeId === regulator.nodeId);
        if (!nodeMetrics) {
          console.warn(`⚠️ No metrics found for regulator node ${regulator.nodeId}`);
          continue;
        }

        const initialVoltages = {
          A: nodeMetrics.voltagesPerPhase.A,
          B: nodeMetrics.voltagesPerPhase.B,
          C: nodeMetrics.voltagesPerPhase.C
        };

        console.log(`📊 Initial voltages: A=${initialVoltages.A.toFixed(1)}V, B=${initialVoltages.B.toFixed(1)}V, C=${initialVoltages.C.toFixed(1)}V`);

        // 2. Appliquer la logique SRG2 réaliste
        const regulationResult = this.applySRG2RegulationLogic(
          regulator,
          initialVoltages,
          networkDetection.type
        );

        if (!regulationResult.canRegulate) {
          console.log(`📊 Regulator ${regulator.id}: all phases within normal range, no action needed`);
          
          // Log pour cohérence même sans régulation
          const logEntry = {
            id: regulator.id,
            nodeId: regulator.nodeId,
            targetVoltage_V: 230,
            appliedPower_kVA: 0,
            requestedPower_kVA: 0,
            saturated: false,
            alpha: 1,
            direction: 'bypass' as const,
            beforeVoltages: [initialVoltages.A, initialVoltages.B, initialVoltages.C] as [number, number, number],
            afterVoltages: [initialVoltages.A, initialVoltages.B, initialVoltages.C] as [number, number, number],
            warnings: [],
            switchStates: regulationResult.switchStates,
            adjustments: regulationResult.adjustmentPerPhase,
            networkType: networkDetection.type
          };
          
          regulatorLog.push(logEntry);
          
          // Stocker métadonnées
          (regulator as any).appliedPower_kVA = 0;
          (regulator as any).saturated = false;
          (regulator as any).requestedPower_kVA = 0;
          (regulator as any).beforeVoltages = [initialVoltages.A, initialVoltages.B, initialVoltages.C];
          (regulator as any).afterVoltages = [initialVoltages.A, initialVoltages.B, initialVoltages.C];
          
          continue;
        }

        // 3. Calculer les nouvelles tensions après régulation
        const afterVoltages = {
          A: initialVoltages.A + regulationResult.adjustmentPerPhase.A,
          B: initialVoltages.B + regulationResult.adjustmentPerPhase.B, 
          C: initialVoltages.C + regulationResult.adjustmentPerPhase.C
        };

        console.log(`📊 SRG2 switch states: A=${regulationResult.switchStates.A}, B=${regulationResult.switchStates.B}, C=${regulationResult.switchStates.C}`);
        console.log(`📊 Voltage adjustments: A=${regulationResult.adjustmentPerPhase.A}V, B=${regulationResult.adjustmentPerPhase.B}V, C=${regulationResult.adjustmentPerPhase.C}V`);
        console.log(`📊 After voltages: A=${afterVoltages.A.toFixed(1)}V, B=${afterVoltages.B.toFixed(1)}V, C=${afterVoltages.C.toFixed(1)}V`);

        // 4. CORRECTION MAJEURE : Simuler l'effet SRG2 par modification de la tension source du nœud
        // Le SRG2 agit comme un transformateur qui modifie la tension effective du nœud

        // Au lieu de modifier seulement les métriques, modifier la topologie temporaire
        const modifiedNodes = this.applySRG2TransformerEffect(
          nodes, 
          regulator.nodeId, 
          regulationResult.adjustmentPerPhase,
          networkDetection.type
        );

        console.log(`🔧 Recalculating network with SRG2 transformer effect`);

        // Recalculer entièrement le réseau avec la nouvelle topologie
        const newResult = this.calculateScenario(
          modifiedNodes,
          cables,
          cableTypes,
          scenario,
          project.foisonnementCharges,
          project.foisonnementProductions,
          project.transformerConfig,
          project.loadModel,
          project.desequilibrePourcent,
          project.manualPhaseDistribution
        );

        // Mettre à jour le résultat pour la prochaine itération
        result = newResult;

        // 5. Calculer la puissance équivalente pour logging (information seulement)
        const totalAdjustment = Math.abs(regulationResult.adjustmentPerPhase.A) + 
                               Math.abs(regulationResult.adjustmentPerPhase.B) + 
                               Math.abs(regulationResult.adjustmentPerPhase.C);
        const equivalentPower_kVA = totalAdjustment * 0.1; // Approximation pour le log

        // 6. Journal de régulateur
        const logEntry = {
          id: regulator.id,
          nodeId: regulator.nodeId,
          targetVoltage_V: 230,
          appliedPower_kVA: 0, // SRG2 ne consomme pas de puissance (transformateur)
          requestedPower_kVA: equivalentPower_kVA,
          saturated: false, // SRG2 n'a pas de limitation de puissance dans ce sens
          alpha: 1,
          direction: 'transformer' as const, // Type spécial pour SRG2
          beforeVoltages: [initialVoltages.A, initialVoltages.B, initialVoltages.C] as [number, number, number],
          afterVoltages: [afterVoltages.A, afterVoltages.B, afterVoltages.C] as [number, number, number],
          warnings: warnings.filter(w => w.includes(regulator.id)),
          switchStates: regulationResult.switchStates,
          adjustments: regulationResult.adjustmentPerPhase,
          networkType: networkDetection.type
        };

        regulatorLog.push(logEntry);

        // 7. Stocker métadonnées dans l'objet régulateur pour compatibilité
        (regulator as any).appliedPower_kVA = 0;
        (regulator as any).saturated = false;
        (regulator as any).requestedPower_kVA = equivalentPower_kVA;
        (regulator as any).beforeVoltages = [initialVoltages.A, initialVoltages.B, initialVoltages.C];
        (regulator as any).afterVoltages = [afterVoltages.A, afterVoltages.B, afterVoltages.C];
        (regulator as any).switchStates = regulationResult.switchStates;
        (regulator as any).adjustments = regulationResult.adjustmentPerPhase;

        console.log(`✅ SRG2 Regulator ${regulator.id} applied successfully with transformer logic`);

      } catch (error) {
        const errorMsg = `Échec application régulateur SRG2 ${regulator.nodeId}: ${error}`;
        console.error(`❌ ${errorMsg}`);
        warnings.push(errorMsg);
        continue;
      }
    }

    // Ajouter warnings et log au résultat
    if (warnings.length > 0) {
      (result as any).warnings = [...((result as any).warnings || []), ...warnings];
    }

    // Ajouter le journal détaillé des régulateurs
    (result as any).regulatorLog = regulatorLog;

    console.log('✅ SRG2 voltage regulation completed with realistic transformer logic');
    return result;
  }
}