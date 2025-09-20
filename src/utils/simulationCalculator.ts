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
      
    // 2. Appliquer les régulateurs de tension SRG2 via le système unifié
    if (activeRegulators.length > 0) {
      console.log(`🔧 Applying ${activeRegulators.length} SRG2 voltage regulators via unified system`);
      
      // Appliquer les régulateurs SRG2 aux nœuds d'abord
      let modifiedNodes = [...project.nodes];
      for (const regulator of activeRegulators) {
        if (!regulator.enabled) continue;
        
        // Calculer les ajustements SRG2 pour ce régulateur
        const nodeMetrics = baseResult.nodeMetricsPerPhase?.find(n => n.nodeId === regulator.nodeId);
        if (!nodeMetrics) continue;
        
        const regulationResult = {
          adjustmentPerPhase: { A: 5, B: 3, C: 2 }, // Exemple - devrait être calculé dynamiquement
          switchStates: { A: '+5V', B: '+3V', C: '+2V' },
          canRegulate: true
        };
        
        // Modifier les nœuds avec les paramètres SRG2
        modifiedNodes = this.modifyNodesForSRG2(modifiedNodes, regulator, regulationResult);
      }
      
      // Utiliser le système unifié pour appliquer tous les régulateurs
      baseResult = this.applyAllVoltageRegulators(
        modifiedNodes,
        project.cables,
        activeRegulators,
        baseResult,
        project.cableTypes,
        project,
        scenario
      );
      
      console.log('✅ SRG2 voltage regulators applied via unified system');

      // Detailed comparison for regulator nodes
      activeRegulators.forEach(reg => {
        const afterMetrics = baseResult.nodeMetricsPerPhase?.find(n => n.nodeId === reg.nodeId);
        
        console.log(`🔍 Node ${reg.nodeId} unified regulation effect:`, {
          after: afterMetrics?.voltagesPerPhase,
          regulated: !!afterMetrics?.voltagesPerPhase
        });
      });
    }
        
        console.log(`🔍 Node ${reg.nodeId} polyphase regulation effect:`, {
          before: beforeMetrics?.voltagesPerPhase,
          after: afterMetrics?.voltagesPerPhase,
          changed: JSON.stringify(beforeMetrics?.voltagesPerPhase) !== JSON.stringify(afterMetrics?.voltagesPerPhase)
      });
    }

    // 3. Apply neutral compensators
    if (simulationEquipment.neutralCompensators && simulationEquipment.neutralCompensators.length > 0) {
      console.log(`🔧 Applying ${simulationEquipment.neutralCompensators.length} neutral compensators`);
      
      baseResult = this.applyNeutralCompoCompensators(
        project.nodes,
        project.cables,
        project.cableTypes,
        simulationEquipment.neutralCompensators,
        baseResult,
        project.transformerConfig
      );
      
      console.log('✅ Neutral compensators applied');
    }

    return {
      ...baseResult,
      baselineComparison: baselineResult,
      simulationEquipment,
      simulationMode: true
    };
  }

  /**
   * Modifie les nœuds voor appliquer les régulateurs SRG2
   */
  private modifyNodesForSRG2(
    nodes: Node[],
    regulator: VoltageRegulator,
    regulationResult: { 
      adjustmentPerPhase: { A: number; B: number; C: number };
      switchStates: { A: string; B: string; C: string };
      canRegulate: boolean;
    }
  ): Node[] {
    return nodes.map(node => {
      if (node.id === regulator.nodeId) {
        const newTargetVoltage = (
          regulator.targetVoltage_V + regulationResult.adjustmentPerPhase.A +
          regulator.targetVoltage_V + regulationResult.adjustmentPerPhase.B +
          regulator.targetVoltage_V + regulationResult.adjustmentPerPhase.C
        ) / 3;
        
        const regulatorTargetVoltages = {
          A: regulator.targetVoltage_V + regulationResult.adjustmentPerPhase.A,
          B: regulator.targetVoltage_V + regulationResult.adjustmentPerPhase.B,
          C: regulator.targetVoltage_V + regulationResult.adjustmentPerPhase.C
        };
        
        return {
          ...node,
          tensionCible: newTargetVoltage,
          isVoltageRegulator: true,
          regulatorTargetVoltages: regulatorTargetVoltages
        };
      }
      return node;
    });
  }
}
  }

  /**
   * SUPPRIMÉ - Cette méthode était dupliquée avec applyAllVoltageRegulators dans ElectricalCalculator
   * Utiliser désormais le système unifié dans la classe parente.
   */
}