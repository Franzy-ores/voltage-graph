import {
  CalculationResult,
  Project,
  Node,
  Cable,
  CableType,
  CalculationScenario,
  TransformerConfig,
  LoadModel,
  NeutralCompensator,
  SimulationEquipment,
  SimulationResult,
  CableUpgrade,
} from '@/types/network';
import { SRG2Config, SRG2SimulationResult, SRG2SwitchState, DEFAULT_SRG2_400_CONFIG, DEFAULT_SRG2_230_CONFIG } from '@/types/srg2';
import { ElectricalCalculator } from '@/utils/electricalCalculations';
import { Complex, C, add, sub, mul, div, abs, fromPolar, scale } from '@/utils/complex';

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
   * Utilise la nouvelle logique en 2 phases:
   * Phase 1: Calibration du foisonnement (mode nuit)
   * Phase 2: Convergence sur les répartitions de phases basées sur les tensions mesurées
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
    
    console.log('🚀 CALIBRATION ACTIVÉE - Début du mode forcé avec convergence complète');
    
    // Préparer les tensions mesurées
    const preparedVoltages = this.prepareMeasuredVoltages(measuredVoltages, project.voltageSystem);
    
    // Phase 1: Calibration du foisonnement des charges (mode nuit sans production)
    console.log('📊 Phase 1: Calibration du foisonnement des charges');
    const calibratedFoisonnement = this.calibrateFoisonnement(
      project,
      'FORCÉ',
      { targetVoltage: sourceVoltage, measuredVoltages: preparedVoltages, measurementNodeId },
      project.foisonnementCharges
    );
    
    console.log(`✅ Foisonnement calibré: ${calibratedFoisonnement.toFixed(1)}%`);
    
    // Phase 2: Convergence sur les répartitions de phases avec les tensions mesurées
    console.log('📊 Phase 2: Convergence sur les répartitions de phases');
    
    let iterations = 0;
    let converged = false;
    let currentDistribution = this.calculateImbalanceFromVoltages(preparedVoltages);
    let previousError = Infinity;
    
    while (!converged && iterations < 50) {
      iterations++;
      
      // Calculer avec les distributions actuelles
      const result = this.calculateScenario(
        project.nodes,
        project.cables,
        project.cableTypes,
        'FORCÉ',
        calibratedFoisonnement,
        project.foisonnementProductions,
        project.transformerConfig,
        project.loadModel,
        project.desequilibrePourcent,
        currentDistribution
      );
      
      // Récupérer les tensions calculées au nœud de mesure
      const measuredNode = result.nodeMetricsPerPhase?.find(nm => nm.nodeId === measurementNodeId);
      if (!measuredNode?.voltagesPerPhase) {
        console.warn('⚠️ Impossible de trouver les tensions au nœud de mesure');
        break;
      }
      
      // Calculer les erreurs de tension par phase
      const voltageErrors = {
        A: Math.abs(measuredNode.voltagesPerPhase.A - preparedVoltages.U1),
        B: Math.abs(measuredNode.voltagesPerPhase.B - preparedVoltages.U2),
        C: Math.abs(measuredNode.voltagesPerPhase.C - preparedVoltages.U3)
      };
      
      const maxError = Math.max(voltageErrors.A, voltageErrors.B, voltageErrors.C);
      
      console.log(`🔄 Itération ${iterations}: Erreur max = ${maxError.toFixed(2)}V`);
      
      // Vérifier la convergence
      if (maxError < SimulationCalculator.CONVERGENCE_TOLERANCE_V || Math.abs(maxError - previousError) < 0.001) {
        converged = true;
        console.log('✅ Convergence atteinte');
        
        return {
          result,
          foisonnementCharges: calibratedFoisonnement,
          desequilibrePourcent: project.desequilibrePourcent || 0,
          voltageErrors,
          iterations,
          convergenceStatus: 'converged',
          finalLoadDistribution: currentDistribution.charges,
          finalProductionDistribution: currentDistribution.productions,
          calibratedFoisonnementCharges: calibratedFoisonnement
        };
      }
      
      // Ajuster les distributions basées sur les erreurs
      currentDistribution = this.calculateImbalanceFromVoltages({
        U1: measuredNode.voltagesPerPhase.A,
        U2: measuredNode.voltagesPerPhase.B,
        U3: measuredNode.voltagesPerPhase.C
      });
      previousError = maxError;
    }
    
    // Si pas de convergence après max iterations
    console.warn('⚠️ Convergence non atteinte après', iterations, 'itérations');
    
    const finalResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      'FORCÉ',
      calibratedFoisonnement,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent,
      currentDistribution
    );
    
    return {
      result: finalResult,
      foisonnementCharges: calibratedFoisonnement,
      desequilibrePourcent: project.desequilibrePourcent || 0,
      iterations,
      convergenceStatus: 'not_converged',
      finalLoadDistribution: currentDistribution.charges,
      finalProductionDistribution: currentDistribution.productions,
      calibratedFoisonnementCharges: calibratedFoisonnement
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
        sourceVoltage = config.targetVoltage;
      }
    }
    
    console.log('🚀 Mode FORCÉ ACTIVÉ: Simulation avec calibration et convergence complètes');
    
    // Phase 1: Calibration du foisonnement des charges (mode nuit sans production)
    console.log('📊 Phase 1: Calibration automatique du foisonnement');
    const calibratedFoisonnement = this.calibrateFoisonnement(
      project,
      scenario,
      config,
      project.foisonnementCharges
    );
    
    console.log(`✅ Foisonnement calibré: ${calibratedFoisonnement.toFixed(1)}%`);
    
    // Phase 2: Convergence sur les répartitions de phases avec mesures réelles
    console.log('📊 Phase 2: Ajustement des répartitions de phases');
    
    let iterations = 0;
    let converged = false;
    const preparedVoltages = this.prepareMeasuredVoltages(config.measuredVoltages, project.voltageSystem);
    let currentDistribution = this.calculateImbalanceFromVoltages(preparedVoltages);
    let previousError = Infinity;
    
    while (!converged && iterations < SimulationCalculator.SIM_MAX_LOCAL_ITERATIONS) {
      iterations++;
      
      // Calculer avec la distribution actuelle
      const result = this.calculateScenario(
        project.nodes,
        project.cables,
        project.cableTypes,
        scenario,
        calibratedFoisonnement,
        project.foisonnementProductions,
        project.transformerConfig,
        project.loadModel,
        project.desequilibrePourcent,
        currentDistribution
      );
      
      // Vérifier les tensions au nœud de mesure
      const measuredNode = result.nodeMetricsPerPhase?.find(nm => nm.nodeId === config.measurementNodeId);
      if (!measuredNode?.voltagesPerPhase) {
        console.warn('⚠️ Nœud de mesure non trouvé, arrêt de la convergence');
        converged = true;
        break;
      }
      
      // Calculer l'erreur de tension
      const voltageErrors = {
        A: Math.abs(measuredNode.voltagesPerPhase.A - preparedVoltages.U1),
        B: Math.abs(measuredNode.voltagesPerPhase.B - preparedVoltages.U2),
        C: Math.abs(measuredNode.voltagesPerPhase.C - preparedVoltages.U3)
      };
      
      const maxError = Math.max(voltageErrors.A, voltageErrors.B, voltageErrors.C);
      
      console.log(`🔄 Itération ${iterations}: Erreur max = ${maxError.toFixed(2)}V`);
      
      // Vérifier la convergence (erreur < 1V)
      if (maxError < 1.0 || Math.abs(maxError - previousError) < 0.01) {
        converged = true;
        console.log('✅ Convergence atteinte');
        break;
      }
      
      // Ajuster les distributions pour la prochaine itération
      currentDistribution = this.calculateImbalanceFromVoltages({
        U1: measuredNode.voltagesPerPhase.A,
        U2: measuredNode.voltagesPerPhase.B,
        U3: measuredNode.voltagesPerPhase.C
      });
      previousError = maxError;
    }
    
    // Calcul final avec les paramètres convergés
    const finalResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      scenario,
      calibratedFoisonnement,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent,
      currentDistribution
    );
    
    const convergenceResult = {
      result: finalResult,
      converged,
      finalDistribution: currentDistribution,
      iterations,
      maxError: previousError
    };
    
    // Mise à jour finale dans l'interface
    const finalUpdateEvent = new CustomEvent('updateProjectFoisonnement', { 
      detail: { 
        foisonnementCharges: calibratedFoisonnement,
        foisonnementProductions: 100,
        finalDistribution: convergenceResult.finalDistribution,
        keepSliderEnabled: true
      } 
    });
    window.dispatchEvent(finalUpdateEvent);
    
    // Retourner le résultat avec toutes les informations de convergence
    return {
      ...convergenceResult.result,
      convergenceStatus: convergenceResult.converged ? 'converged' : 'not_converged',
      finalLoadDistribution: convergenceResult.finalDistribution.charges,
      finalProductionDistribution: convergenceResult.finalDistribution.productions,
      calibratedFoisonnementCharges: calibratedFoisonnement,
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
   * Utilise une recherche binaire pour trouver le foisonnement optimal basé sur la tension cible
   */
  private calibrateFoisonnement(
    project: Project,
    scenario: CalculationScenario,
    config: any,
    initialFoisonnement: number
  ): number {
    console.log('🔧 Calibration du foisonnement en cours...');
    
    const targetVoltage = config.targetVoltage || 230;
    const measurementNodeId = config.measurementNodeId;
    
    if (!measurementNodeId) {
      console.warn('⚠️ Pas de nœud de mesure défini, utilisation du foisonnement initial');
      return initialFoisonnement;
    }
    
    let bestFoisonnement = initialFoisonnement;
    let minDiff = Infinity;
    
    // Recherche du foisonnement optimal entre 50% et 150%
    const foisonnementMin = 50;
    const foisonnementMax = 150;
    const step = 5;
    
    console.log(`🎯 Recherche du foisonnement optimal pour tension cible: ${targetVoltage}V`);
    
    for (let f = foisonnementMin; f <= foisonnementMax; f += step) {
      // Calculer avec ce foisonnement
      const result = this.calculateScenario(
        project.nodes,
        project.cables,
        project.cableTypes,
        scenario,
        f,
        0, // Pas de production en mode nuit
        project.transformerConfig,
        project.loadModel,
        0, // Pas de déséquilibre en mode nuit
        { charges: { A: 33.33, B: 33.33, C: 33.33 }, productions: { A: 33.33, B: 33.33, C: 33.33 } }
      );
      
      // Récupérer la tension moyenne au nœud de mesure
      const measuredNode = result.nodeMetricsPerPhase?.find(nm => nm.nodeId === measurementNodeId);
      if (measuredNode?.voltagesPerPhase) {
        const avgVoltage = (measuredNode.voltagesPerPhase.A + measuredNode.voltagesPerPhase.B + measuredNode.voltagesPerPhase.C) / 3;
        const diff = Math.abs(avgVoltage - targetVoltage);
        
        if (diff < minDiff) {
          minDiff = diff;
          bestFoisonnement = f;
        }
        
        console.log(`  f=${f}%: tension=${avgVoltage.toFixed(1)}V, diff=${diff.toFixed(2)}V`);
      }
    }
    
    console.log(`✅ Foisonnement optimal trouvé: ${bestFoisonnement}% (erreur: ${minDiff.toFixed(2)}V)`);
    
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

    console.log('🎯 SRG2 simulation terminée - nettoyage des marqueurs maintenant');
    // Nettoyage des marqueurs SRG2 après calcul final et utilisation des résultats
    this.cleanupSRG2Markers(project.nodes);

    return {
      ...simulationResult,
      isSimulation: true,
      equipment,
      baselineResult,
      convergenceStatus: (simulationResult as any).convergenceStatus || (baselineResult as any).convergenceStatus
    };
  }

  /**
   * Calcule un scénario en intégrant les équipements de simulation avec mode itératif pour SRG2 et compensateurs
   */
  private calculateScenarioWithEquipment(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): CalculationResult {
    
    // Détection des équipements actifs
    const activeSRG2 = equipment.srg2Devices?.filter(srg2 => srg2.enabled) || [];
    const activeCompensators = equipment.neutralCompensators?.filter(c => c.enabled) || [];
    
    // Cas 1: Aucun équipement actif → calcul normal (CODE EXISTANT INCHANGÉ)
    if (activeSRG2.length === 0 && activeCompensators.length === 0) {
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
    
    // Cas 2: Uniquement SRG2 → code existant (INCHANGÉ)
    if (activeSRG2.length > 0 && activeCompensators.length === 0) {
      return this.calculateWithSRG2Regulation(
        project,
        scenario,
        activeSRG2
      );
    }
    
    // Cas 3: Uniquement compensateurs → nouvelle méthode
    if (activeSRG2.length === 0 && activeCompensators.length > 0) {
      return this.calculateWithNeutralCompensation(
        project,
        scenario,
        activeCompensators
      );
    }
    
    // Cas 4: Les deux actifs → calcul avec SRG2 puis compensateurs
    const srg2Result = this.calculateWithSRG2Regulation(project, scenario, activeSRG2);
    return this.applyNeutralCompensatorsToResult(srg2Result, project, activeCompensators);
  }

  /**
   * Calcule le courant de neutre à partir des courants de phases
   */
  private calculateNeutralCurrent(
    I_A: Complex,
    I_B: Complex,
    I_C: Complex
  ): { magnitude: number; complex: Complex } {
    // I_N = I_A + I_B + I_C (loi de Kirchhoff)
    const I_N = add(add(I_A, I_B), I_C);
    return {
      magnitude: abs(I_N),
      complex: I_N
    };
  }

  /**
   * Applique le modèle EQUI8 (CME Transformateur) pour compensation de neutre
   * Basé sur la documentation technique EQUI8 avec formules linéarisées
   */
  private applyEQUI8Compensation(
    Uinit_ph1: number,
    Uinit_ph2: number,
    Uinit_ph3: number,
    I_A_total: Complex,
    I_B_total: Complex,
    I_C_total: Complex,
    compensator: NeutralCompensator
  ): {
    UEQUI8_ph1: number;
    UEQUI8_ph2: number;
    UEQUI8_ph3: number;
    I_EQUI8_A: number;
    reductionPercent: number;
    iN_initial_A: number;
    iN_absorbed_A: number;
    isLimited: boolean;
    compensationQ_kVAr: { A: number; B: number; C: number };
    // Métriques intermédiaires pour debug/affichage
    umoy_init_V: number;
    umax_init_V: number;
    umin_init_V: number;
    ecart_init_V: number;
    ecart_equi8_V: number;
  } {
    // Extraire les paramètres EQUI8
    const Zph = compensator.Zph_Ohm;
    const Zn = compensator.Zn_Ohm;
    
    // Validation des conditions EQUI8 : Zph et Zn > 0,15 Ω
    if (Zph < 0.15 || Zn < 0.15) {
      console.warn(`⚠️ EQUI8 au nœud ${compensator.nodeId}: Zph (${Zph.toFixed(3)}Ω) ou Zn (${Zn.toFixed(3)}Ω) < 0,15Ω - Précision réduite`);
    }
    
    // Calculer le courant de neutre initial
    const { magnitude: I_N_initial } = this.calculateNeutralCurrent(I_A_total, I_B_total, I_C_total);
    
    // Si en dessous du seuil de tolérance, pas de compensation
    if (I_N_initial <= compensator.tolerance_A) {
      return {
        UEQUI8_ph1: Uinit_ph1,
        UEQUI8_ph2: Uinit_ph2,
        UEQUI8_ph3: Uinit_ph3,
        I_EQUI8_A: I_N_initial,
        reductionPercent: 0,
        iN_initial_A: I_N_initial,
        iN_absorbed_A: 0,
        isLimited: false,
        compensationQ_kVAr: { A: 0, B: 0, C: 0 },
        umoy_init_V: (Uinit_ph1 + Uinit_ph2 + Uinit_ph3) / 3,
        umax_init_V: Math.max(Uinit_ph1, Uinit_ph2, Uinit_ph3),
        umin_init_V: Math.min(Uinit_ph1, Uinit_ph2, Uinit_ph3),
        ecart_init_V: Math.max(Uinit_ph1, Uinit_ph2, Uinit_ph3) - Math.min(Uinit_ph1, Uinit_ph2, Uinit_ph3),
        ecart_equi8_V: Math.max(Uinit_ph1, Uinit_ph2, Uinit_ph3) - Math.min(Uinit_ph1, Uinit_ph2, Uinit_ph3)
      };
    }

    // === CALCULS INTERMÉDIAIRES EQUI8 ===
    
    // 1. Calculer les statistiques des tensions initiales
    const Umoy_init = (Uinit_ph1 + Uinit_ph2 + Uinit_ph3) / 3;
    const Umax_init = Math.max(Uinit_ph1, Uinit_ph2, Uinit_ph3);
    const Umin_init = Math.min(Uinit_ph1, Uinit_ph2, Uinit_ph3);
    const ecart_init = Umax_init - Umin_init;
    
    // Si pas de déséquilibre, pas de compensation nécessaire
    if (ecart_init < 0.1) {
      return {
        UEQUI8_ph1: Uinit_ph1,
        UEQUI8_ph2: Uinit_ph2,
        UEQUI8_ph3: Uinit_ph3,
        I_EQUI8_A: I_N_initial,
        reductionPercent: 0,
        iN_initial_A: I_N_initial,
        iN_absorbed_A: 0,
        isLimited: false,
        compensationQ_kVAr: { A: 0, B: 0, C: 0 },
        umoy_init_V: Umoy_init,
        umax_init_V: Umax_init,
        umin_init_V: Umin_init,
        ecart_init_V: ecart_init,
        ecart_equi8_V: ecart_init
      };
    }
    
    // 2. Calculer les ratios pour chaque phase (conservation des proportions)
    const Ratio_ph1 = (Uinit_ph1 - Umoy_init) / ecart_init;
    const Ratio_ph2 = (Uinit_ph2 - Umoy_init) / ecart_init;
    const Ratio_ph3 = (Uinit_ph3 - Umoy_init) / ecart_init;
    
    // 3. Formule EQUI8 pour l'écart de tension après compensation
    // (Umax-Umin)EQUI8 = 1 / [0,9119 × Ln(Zph) + 3,8654] × (Umax-Umin)init × 2 × Zph / (Zph + Zn)
    const lnZph = Math.log(Zph);
    const denominateur = 0.9119 * lnZph + 3.8654;
    const facteur_impedance = (2 * Zph) / (Zph + Zn);
    const ecart_equi8 = (1 / denominateur) * ecart_init * facteur_impedance;
    
    // 4. Calculer les tensions finales avec EQUI8
    // UEQUI8-phX = Umoy-3Ph-init + Ratio-phX × (Umax-Umin)EQUI8
    const UEQUI8_ph1 = Umoy_init + Ratio_ph1 * ecart_equi8;
    const UEQUI8_ph2 = Umoy_init + Ratio_ph2 * ecart_equi8;
    const UEQUI8_ph3 = Umoy_init + Ratio_ph3 * ecart_equi8;
    
    // 5. Calculer le courant dans le neutre de l'EQUI8
    // I-EQUI8 = 0,392 × Zph^(-0,8065) × (Umax - Umin)init × 2 × Zph / (Zph + Zn)
    const I_EQUI8 = 0.392 * Math.pow(Zph, -0.8065) * ecart_init * facteur_impedance;
    
    // 6. Calculer la réduction de courant de neutre
    const I_N_absorbed = Math.max(0, I_N_initial - I_EQUI8);
    const reductionPercent = I_N_initial > 0 ? (I_N_absorbed / I_N_initial) * 100 : 0;
    
    // 7. Vérifier la limitation par puissance
    // P ≈ √3 × Umoy × I_absorbed
    const estimatedPower_kVA = (Math.sqrt(3) * Umoy_init * I_N_absorbed) / 1000;
    let isLimited = false;
    
    if (estimatedPower_kVA > compensator.maxPower_kVA) {
      isLimited = true;
      console.warn(`⚠️ EQUI8 limité par puissance: ${estimatedPower_kVA.toFixed(1)} kVA demandés > ${compensator.maxPower_kVA} kVA disponibles`);
    }
    
    // Estimation des puissances réactives (pour affichage)
    const Q_per_phase = Math.min(estimatedPower_kVA, compensator.maxPower_kVA) / 3;

    console.log(`📐 EQUI8 au nœud ${compensator.nodeId}:`, {
      'Tensions init': `${Uinit_ph1.toFixed(1)}V / ${Uinit_ph2.toFixed(1)}V / ${Uinit_ph3.toFixed(1)}V`,
      'Écart init': `${ecart_init.toFixed(1)}V`,
      'Écart EQUI8': `${ecart_equi8.toFixed(1)}V`,
      'Tensions EQUI8': `${UEQUI8_ph1.toFixed(1)}V / ${UEQUI8_ph2.toFixed(1)}V / ${UEQUI8_ph3.toFixed(1)}V`,
      'I_N': `${I_N_initial.toFixed(1)}A → ${I_EQUI8.toFixed(1)}A`,
      'Réduction': `${reductionPercent.toFixed(1)}%`
    });

    return {
      UEQUI8_ph1,
      UEQUI8_ph2,
      UEQUI8_ph3,
      I_EQUI8_A: I_EQUI8,
      reductionPercent,
      iN_initial_A: I_N_initial,
      iN_absorbed_A: I_N_absorbed,
      isLimited,
      compensationQ_kVAr: { A: Q_per_phase, B: Q_per_phase, C: Q_per_phase },
      umoy_init_V: Umoy_init,
      umax_init_V: Umax_init,
      umin_init_V: Umin_init,
      ecart_init_V: ecart_init,
      ecart_equi8_V: ecart_equi8
    };
  }

  /**
   * Calcule un scénario avec compensation de neutre uniquement
   */
  private calculateWithNeutralCompensation(
    project: Project,
    scenario: CalculationScenario,
    compensators: NeutralCompensator[]
  ): CalculationResult {
    // 1. Calcul de base sans équipement
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
    
    return this.applyNeutralCompensatorsToResult(baseResult, project, compensators);
  }

  /**
   * Applique les compensateurs de neutre aux résultats de calcul
   */
  private applyNeutralCompensatorsToResult(
    result: CalculationResult,
    project: Project,
    compensators: NeutralCompensator[]
  ): CalculationResult {
    // 2. Appliquer chaque compensateur
    for (const compensator of compensators) {
      const node = project.nodes.find(n => n.id === compensator.nodeId);
      if (!node) {
        console.warn(`⚠️ Nœud ${compensator.nodeId} non trouvé pour compensateur`);
        continue;
      }
      
      // Récupérer les métriques du nœud (si mode monophasé réparti)
      if (project.loadModel === 'monophase_reparti' && result.nodeMetricsPerPhase) {
        const nodeMetrics = result.nodeMetricsPerPhase.find(nm => nm.nodeId === compensator.nodeId);
        if (!nodeMetrics) continue;
        
        // Récupérer les courants de phase depuis les câbles parent
        const parentCables = project.cables.filter(c => c.nodeBId === compensator.nodeId);
        if (parentCables.length === 0) continue;
        
        // Pour chaque câble parent, récupérer les courants de phase
        let I_A_total = C(0, 0);
        let I_B_total = C(0, 0);
        let I_C_total = C(0, 0);
        
        for (const cable of parentCables) {
          const cableResult = result.cables.find(cr => cr.id === cable.id);
          if (!cableResult) continue;
          
          // Estimation des courants de phase (simplifiée)
          const I_total = cableResult.current_A;
          I_A_total = add(I_A_total, C(I_total / 3, 0));
          I_B_total = add(I_B_total, C(I_total / 3, 0));
          I_C_total = add(I_C_total, C(I_total / 3, 0));
        }
        
        // Récupérer les tensions initiales au nœud du compensateur
        const Uinit_ph1 = nodeMetrics.voltagesPerPhase.A;
        const Uinit_ph2 = nodeMetrics.voltagesPerPhase.B;
        const Uinit_ph3 = nodeMetrics.voltagesPerPhase.C;
        
        // Appliquer le modèle EQUI8
        const equi8Result = this.applyEQUI8Compensation(
          Uinit_ph1,
          Uinit_ph2,
          Uinit_ph3,
          I_A_total,
          I_B_total,
          I_C_total,
          compensator
        );
        
        // Mettre à jour les résultats du compensateur avec les valeurs EQUI8
        compensator.iN_initial_A = equi8Result.iN_initial_A;
        compensator.iN_absorbed_A = equi8Result.iN_absorbed_A;
        compensator.currentIN_A = equi8Result.I_EQUI8_A;
        compensator.reductionPercent = equi8Result.reductionPercent;
        compensator.isLimited = equi8Result.isLimited;
        compensator.compensationQ_kVAr = equi8Result.compensationQ_kVAr;
        
        // Métriques intermédiaires EQUI8
        compensator.umoy_init_V = equi8Result.umoy_init_V;
        compensator.umax_init_V = equi8Result.umax_init_V;
        compensator.umin_init_V = equi8Result.umin_init_V;
        compensator.ecart_init_V = equi8Result.ecart_init_V;
        compensator.ecart_equi8_V = equi8Result.ecart_equi8_V;
        
        // Tensions finales calculées par EQUI8
        compensator.u1p_V = equi8Result.UEQUI8_ph1;
        compensator.u2p_V = equi8Result.UEQUI8_ph2;
        compensator.u3p_V = equi8Result.UEQUI8_ph3;
        
        // Appliquer les tensions EQUI8 au nœud du compensateur
        nodeMetrics.voltagesPerPhase.A = equi8Result.UEQUI8_ph1;
        nodeMetrics.voltagesPerPhase.B = equi8Result.UEQUI8_ph2;
        nodeMetrics.voltagesPerPhase.C = equi8Result.UEQUI8_ph3;
        
        // Si compensation active, propager les effets en aval
        if (equi8Result.reductionPercent > 0) {
          this.recalculateDownstreamVoltages(
            result,
            project,
            compensator,
            equi8Result.reductionPercent / 100,
            I_A_total,
            I_B_total,
            I_C_total
          );
        }
        
        console.log(`📊 EQUI8 tensions finales au nœud ${compensator.nodeId}:`, {
          U1p: compensator.u1p_V.toFixed(1) + 'V',
          U2p: compensator.u2p_V.toFixed(1) + 'V',
          U3p: compensator.u3p_V.toFixed(1) + 'V',
          'I_N final': compensator.currentIN_A?.toFixed(1) + 'A',
          'Réduction': compensator.reductionPercent?.toFixed(1) + '%'
        });
      }
    }
    
    return result;
  }

  /**
   * Recalcule les tensions en aval d'un compensateur de neutre
   * Le compensateur EQUI8 consomme de la puissance réactive pour équilibrer les phases,
   * ce qui provoque une chute de tension en aval due au courant absorbé
   */
  private recalculateDownstreamVoltages(
    result: CalculationResult,
    project: Project,
    compensator: NeutralCompensator,
    reductionFraction: number,
    I_A: Complex,
    I_B: Complex,
    I_C: Complex
  ): void {
    if (!result.nodeMetricsPerPhase) return;

    console.log(`🔄 Recalcul des tensions en aval du compensateur ${compensator.nodeId}`);

    // Le compensateur absorbe du courant pour équilibrer les phases
    // Ce courant absorbé crée une chute de tension supplémentaire en aval
    const I_absorbed_A = compensator.iN_absorbed_A || 0;
    
    if (I_absorbed_A === 0) {
      console.log(`⚠️ Compensateur ${compensator.nodeId}: pas de courant absorbé, pas d'effet en aval`);
      return;
    }
    
    // Courant absorbé réparti sur les 3 phases (approximation pour calcul de chute de tension)
    const I_absorbed_per_phase = I_absorbed_A / Math.sqrt(3);
    
    // Trouver les nœuds en aval du compensateur
    const downstreamNodes = this.findDownstreamNodes(project, compensator.nodeId);
    
    console.log(`📍 Nœuds en aval: ${downstreamNodes.length}`, downstreamNodes);
    console.log(`⚡ Courant absorbé par compensateur: ${I_absorbed_A.toFixed(1)}A (${I_absorbed_per_phase.toFixed(1)}A par phase)`);
    
    // Pour chaque nœud en aval, calculer la chute de tension due à la consommation du compensateur
    for (const downstreamNodeId of downstreamNodes) {
      const nodeMetrics = result.nodeMetricsPerPhase.find(nm => nm.nodeId === downstreamNodeId);
      if (!nodeMetrics) continue;
      
      // Trouver le chemin de câbles du compensateur au nœud aval
      const pathCables = this.findCablePath(project, compensator.nodeId, downstreamNodeId);
      
      // Calculer l'impédance totale du chemin
      let totalResistance = 0;
      let totalReactance = 0;
      
      for (const cable of pathCables) {
        const cableType = project.cableTypes.find(ct => ct.id === cable.typeId);
        if (!cableType) continue;
        
        const length_km = cable.length_m / 1000;
        totalResistance += cableType.R0_ohm_per_km * length_km;
        totalReactance += cableType.X0_ohm_per_km * length_km;
      }
      
      // Impédance complexe totale
      const Z_total = Math.sqrt(totalResistance * totalResistance + totalReactance * totalReactance);
      
      // Chute de tension due au courant absorbé par le compensateur
      // ΔU = Z × I (réactif principalement)
      const voltageDrop = Z_total * I_absorbed_per_phase;
      
      // Appliquer la chute de tension à chaque phase (DIMINUTION car consommation)
      const oldVoltages = { ...nodeMetrics.voltagesPerPhase };
      nodeMetrics.voltagesPerPhase.A -= voltageDrop;
      nodeMetrics.voltagesPerPhase.B -= voltageDrop;
      nodeMetrics.voltagesPerPhase.C -= voltageDrop;
      
      console.log(`  📉 Nœud ${downstreamNodeId}: A: ${oldVoltages.A.toFixed(1)}V -> ${nodeMetrics.voltagesPerPhase.A.toFixed(1)}V (-${voltageDrop.toFixed(2)}V)`);
      
      // Recalculer les chutes de tension totales
      const sourceVoltage = 230; // Tension nominale de référence
      const dropA = ((sourceVoltage - nodeMetrics.voltagesPerPhase.A) / sourceVoltage) * 100;
      const dropB = ((sourceVoltage - nodeMetrics.voltagesPerPhase.B) / sourceVoltage) * 100;
      const dropC = ((sourceVoltage - nodeMetrics.voltagesPerPhase.C) / sourceVoltage) * 100;
      
      console.log(`  📊 Chutes de tension totales: A: ${dropA.toFixed(2)}%, B: ${dropB.toFixed(2)}%, C: ${dropC.toFixed(2)}%`);
    }
  }

  /**
   * Trouve tous les nœuds en aval d'un nœud donné
   */
  private findDownstreamNodes(project: Project, startNodeId: string): string[] {
    const downstream: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [startNodeId];
    visited.add(startNodeId);
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      
      // Trouver les câbles partant de ce nœud
      const outgoingCables = project.cables.filter(
        c => c.nodeAId === currentId || c.nodeBId === currentId
      );
      
      for (const cable of outgoingCables) {
        const nextNodeId = cable.nodeAId === currentId ? cable.nodeBId : cable.nodeAId;
        
        // Éviter de remonter vers la source (vérifier si le nœud suivant est plus proche de la source)
        if (!visited.has(nextNodeId)) {
          visited.add(nextNodeId);
          downstream.push(nextNodeId);
          queue.push(nextNodeId);
        }
      }
    }
    
    return downstream;
  }

  /**
   * Trouve le chemin de câbles entre deux nœuds
   */
  private findCablePath(project: Project, fromNodeId: string, toNodeId: string): Cable[] {
    const path: Cable[] = [];
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: Cable[] }> = [{ nodeId: fromNodeId, path: [] }];
    visited.add(fromNodeId);
    
    while (queue.length > 0) {
      const { nodeId, path: currentPath } = queue.shift()!;
      
      if (nodeId === toNodeId) {
        return currentPath;
      }
      
      const outgoingCables = project.cables.filter(
        c => c.nodeAId === nodeId || c.nodeBId === nodeId
      );
      
      for (const cable of outgoingCables) {
        const nextNodeId = cable.nodeAId === nodeId ? cable.nodeBId : cable.nodeAId;
        
        if (!visited.has(nextNodeId)) {
          visited.add(nextNodeId);
          queue.push({ nodeId: nextNodeId, path: [...currentPath, cable] });
        }
      }
    }
    
    return path;
  }

  /**
   * Calcul itératif avec régulation SRG2
   * DIAGNOSTIC ID: vérifie la cohérence des IDs pendant toute la simulation
   */
  private calculateWithSRG2Regulation(
    project: Project,
    scenario: CalculationScenario,
    srg2Devices: SRG2Config[]
  ): CalculationResult {
    console.log(`🔍 DIAGNOSTIC ID - Début calculateWithSRG2Regulation`);
    console.log(`📋 IDs des SRG2:`, srg2Devices.map(srg2 => `${srg2.id} -> nœud ${srg2.nodeId}`));
    console.log(`📋 IDs des nœuds du projet:`, project.nodes.map(n => `${n.id} (${n.name})`));
    
    // Vérifier que tous les SRG2 ont des nœuds correspondants
    for (const srg2 of srg2Devices) {
      const nodeExists = project.nodes.find(n => n.id === srg2.nodeId);
      if (!nodeExists) {
        console.error(`❌ SRG2 ${srg2.id} référence un nœud inexistant: ${srg2.nodeId}`);
      } else {
        console.log(`✅ SRG2 ${srg2.id} -> nœud trouvé: ${nodeExists.id} (${nodeExists.name})`);
      }
    }
    
    let iteration = 0;
    let converged = false;
    let previousVoltages: Map<string, {A: number, B: number, C: number}> = new Map();
    
    // Copie des nœuds pour modification itérative
    const workingNodes = JSON.parse(JSON.stringify(project.nodes)) as Node[];
    
    // Stocker les tensions originales avant toute modification SRG2
    const originalVoltages = new Map<string, {A: number, B: number, C: number}>();
    
    while (!converged && iteration < SimulationCalculator.SIM_MAX_ITERATIONS) {
      iteration++;
      
      // Nettoyer les modifications SRG2 précédentes pour obtenir les tensions naturelles du réseau
      if (iteration > 1) {
        this.cleanupSRG2Markers(workingNodes);
      }
      
      // Calculer le scénario avec l'état actuel des nœuds
      const result = this.calculateScenario(
        workingNodes,
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
      
      // Stocker les tensions originales à la première itération
      if (iteration === 1) {
        for (const srg2 of srg2Devices) {
          const nodeMetricsPerPhase = result.nodeMetricsPerPhase?.find(nm => 
            String(nm.nodeId) === String(srg2.nodeId)
          );
          
          if (nodeMetricsPerPhase?.voltagesPerPhase) {
            originalVoltages.set(srg2.nodeId, {
              A: nodeMetricsPerPhase.voltagesPerPhase.A,
              B: nodeMetricsPerPhase.voltagesPerPhase.B,
              C: nodeMetricsPerPhase.voltagesPerPhase.C
            });
            console.log(`📋 Tensions originales stockées pour SRG2 ${srg2.nodeId}:`, originalVoltages.get(srg2.nodeId));
          }
        }
      }

      // Appliquer la régulation SRG2 sur chaque dispositif
      const voltageChanges = new Map<string, {A: number, B: number, C: number}>();
      
      for (const srg2 of srg2Devices) {
        const nodeIndex = workingNodes.findIndex(n => n.id === srg2.nodeId);
        if (nodeIndex === -1) continue;
        
        // Trouver le nœud SRG2 et récupérer ses tensions actuelles
        const srg2Node = workingNodes.find(n => n.id === srg2.nodeId);
        if (!srg2Node) continue;

        // Utiliser les tensions originales stockées pour éviter que le SRG2 lise ses propres tensions modifiées
        let nodeVoltages = originalVoltages.get(srg2.nodeId) || { A: 230, B: 230, C: 230 };
        
        console.log(`🔍 SRG2 ${srg2.nodeId}: utilisation des tensions originales stockées - A=${nodeVoltages.A.toFixed(1)}V, B=${nodeVoltages.B.toFixed(1)}V, C=${nodeVoltages.C.toFixed(1)}V`);

        // Appliquer la régulation SRG2 sur les tensions lues
        const regulationResult = this.applySRG2Regulation(srg2, nodeVoltages, project.voltageSystem);
        
        // Stocker les coefficients de régulation pour ce nœud
        if (regulationResult.coefficientsAppliques) {
          voltageChanges.set(srg2.nodeId, regulationResult.coefficientsAppliques);
          
          // Mettre à jour les informations du SRG2 pour l'affichage
          srg2.tensionEntree = regulationResult.tensionEntree;
          srg2.etatCommutateur = regulationResult.etatCommutateur;
          srg2.coefficientsAppliques = regulationResult.coefficientsAppliques;
        }
      }
      
      // Appliquer les coefficients de régulation SRG2 aux nœuds correspondants
      for (const srg2 of srg2Devices) {
        const coefficients = voltageChanges.get(srg2.nodeId);
        if (coefficients) {
          this.applySRG2Coefficients(workingNodes, srg2, coefficients);
        }
      }
      
      // Vérifier la convergence
      converged = this.checkSRG2Convergence(voltageChanges, previousVoltages);
      previousVoltages = new Map(voltageChanges);
      
      console.log(`🔄 SRG2 Iteration ${iteration}: ${converged ? 'Convergé' : 'En cours...'}`);
    }
    
    // Recalculer une dernière fois avec les tensions finales
    const finalResult = this.calculateScenario(
      workingNodes,
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

    console.log('🎯 SRG2 calcul final terminé - marqueurs SRG2 conservés pour nodeMetricsPerPhase');
    
    // IMPORTANT: Ne pas nettoyer les marqueurs SRG2 ici !
    // Le nettoyage se fait dans calculateWithSimulation() après avoir utilisé les résultats
    // this.cleanupSRG2Markers(workingNodes); ← Déplacé

    return {
      ...finalResult,
      srg2Results: srg2Devices.map(srg2 => ({
        srg2Id: srg2.id,
        nodeId: srg2.nodeId,
        tensionAvant_V: srg2.tensionEntree?.A || 0,
        tensionApres_V: srg2.tensionSortie?.A || 0,
        puissanceReactive_kVAr: 0,
        ameliorationTension_V: (srg2.tensionSortie?.A || 0) - (srg2.tensionEntree?.A || 0),
        erreurRésiduelle_V: Math.abs((srg2.tensionSortie?.A || 0) - 230),
        efficacite_percent: Math.min(100, Math.max(0, (1 - Math.abs((srg2.tensionSortie?.A || 0) - 230) / 230) * 100)),
        tauxCharge_percent: 0,
        regulationActive: srg2.etatCommutateur?.A !== 'BYP',
        saturePuissance: false,
        convergence: converged
      })),
      convergenceStatus: converged ? 'converged' : 'not_converged',
      iterations: iteration
    } as CalculationResult & {
      srg2Results: SRG2SimulationResult[];
      convergenceStatus: 'converged' | 'not_converged';
      iterations: number;
    };
  }


  /**
   * Applique la régulation SRG2 selon les seuils et contraintes
   */
  private applySRG2Regulation(
    srg2: SRG2Config, 
    nodeVoltages: {A: number, B: number, C: number}, 
    voltageSystem: string
  ): {
    tensionEntree: {A: number, B: number, C: number},
    etatCommutateur: {A: SRG2SwitchState, B: SRG2SwitchState, C: SRG2SwitchState},
    coefficientsAppliques: {A: number, B: number, C: number},
    tensionSortie: {A: number, B: number, C: number}
  } {
    
    // Tensions d'entrée lues au nœud d'installation
    const tensionEntree = { ...nodeVoltages };
    
    console.log(`🔍 SRG2 régulation: tensions d'entrée A=${tensionEntree.A.toFixed(1)}V, B=${tensionEntree.B.toFixed(1)}V, C=${tensionEntree.C.toFixed(1)}V`);

    // Déterminer l'état du commutateur pour chaque phase
    const etatCommutateur = {
      A: this.determineSwitchState(tensionEntree.A, srg2),
      B: this.determineSwitchState(tensionEntree.B, srg2),
      C: this.determineSwitchState(tensionEntree.C, srg2)
    };
    
    console.log(`⚙️ SRG2 états commutateurs: A=${etatCommutateur.A}, B=${etatCommutateur.B}, C=${etatCommutateur.C}`);

    // Appliquer les contraintes SRG2-230 si nécessaire
    if (srg2.type === 'SRG2-230') {
      this.applySRG230Constraints(etatCommutateur, tensionEntree, srg2);
    }

    // Calculer les coefficients appliqués
    const coefficientsAppliques = {
      A: this.getVoltageCoefficient(etatCommutateur.A, srg2),
      B: this.getVoltageCoefficient(etatCommutateur.B, srg2),
      C: this.getVoltageCoefficient(etatCommutateur.C, srg2)
    };

    // Calculer les tensions de sortie
    const tensionSortie = {
      A: tensionEntree.A * (1 + coefficientsAppliques.A / 100),
      B: tensionEntree.B * (1 + coefficientsAppliques.B / 100),
      C: tensionEntree.C * (1 + coefficientsAppliques.C / 100)
    };
    
    console.log(`🔧 SRG2 tensions de sortie: A=${tensionSortie.A.toFixed(1)}V, B=${tensionSortie.B.toFixed(1)}V, C=${tensionSortie.C.toFixed(1)}V`);

    return {
      tensionEntree,
      etatCommutateur,
      coefficientsAppliques,
      tensionSortie
    };
  }

  /**
   * Détermine l'état du commutateur selon les seuils de tension
   * Logique: évaluer dans l'ordre pour déterminer l'action nécessaire
   */
  private determineSwitchState(tension: number, srg2: SRG2Config): SRG2SwitchState {
    console.log(`🔍 SRG2 ${srg2.id}: Évaluation seuils pour tension=${tension.toFixed(1)}V`);
    console.log(`📋 Seuils: LO2=${srg2.seuilLO2_V}V, LO1=${srg2.seuilLO1_V}V, BO1=${srg2.seuilBO1_V}V, BO2=${srg2.seuilBO2_V}V`);
    
    // Tensions trop hautes (abaissement nécessaire)
    if (tension >= srg2.seuilLO2_V) {
      console.log(`➡️ Tension ${tension.toFixed(1)}V >= ${srg2.seuilLO2_V}V → LO2 (abaissement complet)`);
      return 'LO2';
    }
    if (tension >= srg2.seuilLO1_V) {
      console.log(`➡️ Tension ${tension.toFixed(1)}V >= ${srg2.seuilLO1_V}V → LO1 (abaissement partiel)`);
      return 'LO1';
    }
    
    // Tensions trop basses (boost nécessaire)  
    if (tension <= srg2.seuilBO2_V) {
      console.log(`➡️ Tension ${tension.toFixed(1)}V <= ${srg2.seuilBO2_V}V → BO2 (boost complet)`);
      return 'BO2';
    }
    if (tension < srg2.seuilLO1_V && tension > srg2.seuilBO1_V) {
      console.log(`➡️ Tension ${tension.toFixed(1)}V entre ${srg2.seuilBO1_V}V et ${srg2.seuilLO1_V}V → BYP (plage acceptable)`);
      return 'BYP';
    }
    if (tension <= srg2.seuilBO1_V) {
      console.log(`➡️ Tension ${tension.toFixed(1)}V <= ${srg2.seuilBO1_V}V → BO1 (boost partiel)`);
      return 'BO1';
    }
    
    // Fallback (ne devrait pas arriver)
    console.log(`⚠️ Tension ${tension.toFixed(1)}V - cas non prévu → BYP (fallback)`);
    return 'BYP';
  }

  /**
   * Applique les contraintes du SRG2-230 (si une phase monte, les autres ne peuvent descendre)
   */
  private applySRG230Constraints(
    etatCommutateur: {A: SRG2SwitchState, B: SRG2SwitchState, C: SRG2SwitchState},
    tensionEntree: {A: number, B: number, C: number},
    srg2: SRG2Config
  ): void {
    const phases = ['A', 'B', 'C'] as const;
    const etats = [etatCommutateur.A, etatCommutateur.B, etatCommutateur.C];
    
    // Vérifier s'il y a des directions opposées
    const hasBoost = etats.some(etat => etat === 'BO1' || etat === 'BO2');
    const hasLower = etats.some(etat => etat === 'LO1' || etat === 'LO2');
    
    if (hasBoost && hasLower) {
      // Trouver la phase avec le plus grand écart par rapport à 230V
      let maxDeviation = 0;
      let dominantDirection: 'boost' | 'lower' = 'boost';
      
      phases.forEach(phase => {
        const tension = tensionEntree[phase];
        const deviation = Math.abs(tension - 230);
        if (deviation > maxDeviation) {
          maxDeviation = deviation;
          dominantDirection = tension > 230 ? 'lower' : 'boost';
        }
      });
      
      // Appliquer la contrainte: bloquer la direction opposée
      phases.forEach(phase => {
        const etat = etatCommutateur[phase];
        if (dominantDirection === 'lower' && (etat === 'BO1' || etat === 'BO2')) {
          etatCommutateur[phase] = 'BYP';
        } else if (dominantDirection === 'boost' && (etat === 'LO1' || etat === 'LO2')) {
          etatCommutateur[phase] = 'BYP';
        }
      });
    }
  }

  /**
   * Retourne le coefficient de tension selon l'état du commutateur
   */
  private getVoltageCoefficient(etat: SRG2SwitchState, srg2: SRG2Config): number {
    switch (etat) {
      case 'LO2': return srg2.coefficientLO2;
      case 'LO1': return srg2.coefficientLO1;
      case 'BYP': return 0;
      case 'BO1': return srg2.coefficientBO1;
      case 'BO2': return srg2.coefficientBO2;
    }
  }

  /**
   * Applique les coefficients de régulation SRG2 aux nœuds correspondants
   * Nouvelle approche transformer: les coefficients modifient les tensions calculées
   */
  private applySRG2Coefficients(
    nodes: Node[],
    srg2Device: SRG2Config,
    coefficients: { A: number; B: number; C: number }
  ): void {
    console.log(`🎯 Application coefficients SRG2 ${srg2Device.id} sur nœud ${srg2Device.nodeId}`);
    console.log(`   Coefficients: A=${coefficients.A.toFixed(1)}%, B=${coefficients.B.toFixed(1)}%, C=${coefficients.C.toFixed(1)}%`);

    // Trouver le nœud correspondant
    const nodeIndex = nodes.findIndex(n => String(n.id) === String(srg2Device.nodeId));
    if (nodeIndex === -1) {
      console.error(`❌ Nœud SRG2 non trouvé: ${srg2Device.nodeId}`);
      return;
    }

    // Marquer le nœud comme ayant un dispositif SRG2 avec ses coefficients
    nodes[nodeIndex].hasSRG2Device = true;
    nodes[nodeIndex].srg2RegulationCoefficients = { ...coefficients };

    console.log(`✅ Nœud ${nodes[nodeIndex].id} marqué avec coefficients SRG2`);
  }

  /**
   * Vérifie la convergence de la régulation SRG2
   */
  private checkSRG2Convergence(
    currentVoltages: Map<string, {A: number, B: number, C: number}>,
    previousVoltages: Map<string, {A: number, B: number, C: number}>
  ): boolean {
    
    if (previousVoltages.size === 0) return false;
    
    for (const [nodeId, current] of currentVoltages) {
      const previous = previousVoltages.get(nodeId);
      if (!previous) return false;
      
      const deltaA = Math.abs(current.A - previous.A);
      const deltaB = Math.abs(current.B - previous.B);  
      const deltaC = Math.abs(current.C - previous.C);
      
      const tolerance = SimulationCalculator.SIM_CONVERGENCE_TOLERANCE_PHASE_V;
      if (deltaA > tolerance || deltaB > tolerance || deltaC > tolerance) {
        return false;
      }
    }
    
    return true;
  }

  // SUPPRIMÉ - Méthodes des régulateurs
  
  /**
   * Nettoie les marqueurs SRG2 après calcul pour éviter les interférences
   * PROTECTION CONTRE MUTATION: préserve les IDs originaux
   */
  private cleanupSRG2Markers(nodes: Node[]): void {
    console.log(`🔍 DIAGNOSTIC ID - Début cleanupSRG2Markers`);
    console.log(`📋 IDs des nœuds avant nettoyage:`, nodes.map(n => `${n.id} (hasSRG2Device: ${!!n.hasSRG2Device})`));
    
    for (const node of nodes) {
      if (node.hasSRG2Device) {
        // Sauvegarder l'ID original avant nettoyage
        const originalId = node.id;
        
        // Nettoyer les marqueurs SRG2
        node.hasSRG2Device = undefined;
        node.srg2RegulationCoefficients = undefined;
        
        // Vérifier que l'ID n'a pas été corrompu pendant le nettoyage
        if (node.id !== originalId) {
          console.error(`🚨 CORRUPTION ID lors du nettoyage ! Original: ${originalId}, Actuel: ${node.id}`);
          node.id = originalId; // Restaurer l'ID
        }
        
        console.log(`🧹 Nettoyage marqueurs SRG2 pour nœud ${node.id} (ID préservé)`);
      }
    }
    
    console.log(`🔍 DIAGNOSTIC ID - Fin cleanupSRG2Markers`);
    console.log(`📋 IDs des nœuds après nettoyage:`, nodes.map(n => `${n.id} (hasSRG2Device: ${!!n.hasSRG2Device})`));
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