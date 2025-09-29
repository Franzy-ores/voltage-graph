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
   * BLOQUÉ - Méthode publique pour l'algorithme de convergence du mode forcé
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
    
    // BLOQUÉ - Fonctionnalité de calibration désactivée
    console.log('🚫 CALIBRATION BLOQUÉE - Mode forcé simplifié sans calibration');
    
    // Retourner un résultat basique sans calibration
    const result = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      'FORCÉ',
      project.foisonnementCharges,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent,
      project.manualPhaseDistribution
    );
    
    return {
      result,
      foisonnementCharges: project.foisonnementCharges,
      desequilibrePourcent: project.desequilibrePourcent || 0,
      iterations: 1,
      convergenceStatus: 'converged',
      finalLoadDistribution: { A: 33.33, B: 33.33, C: 33.33 },
      finalProductionDistribution: { A: 33.33, B: 33.33, C: 33.33 },
      calibratedFoisonnementCharges: project.foisonnementCharges
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
   * BLOQUÉ - Nouveau processus Mode Forcé en 2 étapes avec boucle de convergence intelligente du déséquilibre
   * Phase 1: Calibration du foisonnement (nuit) - DÉSACTIVÉE
   * Phase 2: Convergence sur déséquilibre (jour) avec ajustement des répartitions par phase - DÉSACTIVÉE
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
    
    console.log('🚫 Mode FORCÉ BLOQUÉ: Simulation basique sans calibration ni convergence');
    
    // BLOQUÉ - Pas de calibration ni de convergence
    // Utiliser directement les paramètres du projet
    
    // Exécuter une simulation basique sans calibration
    const finalResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      scenario,
      foisonnementCharges,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent,
      project.manualPhaseDistribution
    );
    
    const convergenceResult = {
      result: finalResult,
      converged: true,
      finalDistribution: { charges: { A: 33.33, B: 33.33, C: 33.33 }, productions: { A: 33.33, B: 33.33, C: 33.33 } },
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
   * BLOQUÉ - Calibration du foisonnement des charges (Phase 1)
   * Utilise la même logique que calculateWithTargetVoltage du store
   */
  private calibrateFoisonnement(
    project: Project,
    scenario: CalculationScenario,
    config: any,
    initialFoisonnement: number
  ): number {
    console.log('🚫 CALIBRATION BLOQUÉE - Retour du foisonnement initial');
    return initialFoisonnement;
    
    /* BLOQUÉ - Code de calibration désactivé
    let bestFoisonnement = 100;
    let bestVoltage = 0;
    let minDiff = Infinity;
    */
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

    // Nettoyage des marqueurs SRG2 après calcul
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
   * Calcule un scénario en intégrant les équipements de simulation avec mode itératif pour SRG2
   */
  private calculateScenarioWithEquipment(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): CalculationResult {
    
    // Si pas de SRG2 actifs, calcul normal
    const activeSRG2 = equipment.srg2Devices?.filter(srg2 => srg2.enabled) || [];
    if (activeSRG2.length === 0) {
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

    // Calcul itératif avec régulation SRG2
    return this.calculateWithSRG2Regulation(
      project,
      scenario,
      activeSRG2
    );
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
    
    while (!converged && iteration < SimulationCalculator.SIM_MAX_ITERATIONS) {
      iteration++;
      
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

      // Appliquer la régulation SRG2 sur chaque dispositif
      const voltageChanges = new Map<string, {A: number, B: number, C: number}>();
      
      for (const srg2 of srg2Devices) {
        const nodeIndex = workingNodes.findIndex(n => n.id === srg2.nodeId);
        if (nodeIndex === -1) continue;
        
        // Trouver le nœud SRG2 et récupérer ses tensions actuelles
        const srg2Node = workingNodes.find(n => n.id === srg2.nodeId);
        if (!srg2Node) continue;

        // Lire les tensions du nœud d'installation du SRG2 depuis les résultats de calcul locaux
        let nodeVoltages = { A: 230, B: 230, C: 230 }; // Valeurs par défaut
        let voltagesFound = false;
        
        console.log(`🔍 SRG2 ${srg2.nodeId}: recherche des tensions calculées...`);
        
        // 1. Chercher dans nodeMetricsPerPhase avec normalisation des IDs
        const nodeMetricsPerPhase = result.nodeMetricsPerPhase?.find(nm => 
          String(nm.nodeId) === String(srg2.nodeId)
        );
        
        if (nodeMetricsPerPhase?.voltagesPerPhase) {
          const volts = nodeMetricsPerPhase.voltagesPerPhase;
          console.log(`📊 Tensions par phase trouvées:`, volts);
          
          // Validation des tensions
          if (volts.A > 200 && volts.A < 300 && volts.B > 200 && volts.B < 300 && volts.C > 200 && volts.C < 300) {
            nodeVoltages = { A: volts.A, B: volts.B, C: volts.C };
            voltagesFound = true;
            console.log(`✅ SRG2 ${srg2.nodeId}: TENSIONS RÉELLES UTILISÉES - A=${nodeVoltages.A.toFixed(1)}V, B=${nodeVoltages.B.toFixed(1)}V, C=${nodeVoltages.C.toFixed(1)}V`);
          } else {
            console.warn(`⚠️ SRG2 ${srg2.nodeId}: tensions par phase non réalistes:`, volts);
          }
        }
        
        // 2. Fallback sur nodeMetrics si nodeMetricsPerPhase n'est pas disponible
        if (!voltagesFound) {
          const nodeMetrics = result.nodeMetrics?.find(nm => 
            String(nm.nodeId) === String(srg2.nodeId)
          );
          
          if (nodeMetrics?.V_phase_V !== undefined) {
            const voltage = nodeMetrics.V_phase_V;
            console.log(`📊 Tension unique disponible: ${voltage.toFixed(3)}V`);
            
            if (voltage > 200 && voltage < 300) {
              nodeVoltages = { A: voltage, B: voltage, C: voltage };
              voltagesFound = true;
              console.log(`✅ SRG2 ${srg2.nodeId}: TENSION UNIQUE UTILISÉE ${voltage.toFixed(1)}V sur les 3 phases`);
            } else {
              console.warn(`⚠️ SRG2 ${srg2.nodeId}: tension unique non réaliste: ${voltage}V`);
            }
          }
        }
        
        // 3. Dernière tentative avec correspondance approximative des IDs
        if (!voltagesFound) {
          console.log(`🚨 SRG2 ${srg2.nodeId}: recherche approximative...`);
          const partialMatch = result.nodeMetricsPerPhase?.find(np => 
            String(np.nodeId).includes(String(srg2.nodeId)) || String(srg2.nodeId).includes(String(np.nodeId))
          );
          
          if (partialMatch?.voltagesPerPhase) {
            const volts = partialMatch.voltagesPerPhase;
            console.log(`🎯 Correspondance partielle trouvée: ID=${partialMatch.nodeId}, tensions:`, volts);
            
            if (volts.A > 200 && volts.A < 300) {
              nodeVoltages = { A: volts.A, B: volts.B, C: volts.C };
              voltagesFound = true;
              console.log(`✅ SRG2 ${srg2.nodeId}: TENSIONS PARTIELLES UTILISÉES - A=${nodeVoltages.A.toFixed(1)}V, B=${nodeVoltages.B.toFixed(1)}V, C=${nodeVoltages.C.toFixed(1)}V`);
            }
          }
        }
        
        if (!voltagesFound) {
          console.warn(`⚠️ SRG2 ${srg2.nodeId}: utilisation de tensions par défaut (${nodeVoltages.A}V)`);
        }

        // Appliquer la régulation SRG2 sur les tensions lues
        const regulationResult = this.applySRG2Regulation(srg2, nodeVoltages, project.voltageSystem);
        
        // Stocker les changements de tension pour ce nœud
        if (regulationResult.tensionSortie) {
          voltageChanges.set(srg2.nodeId, regulationResult.tensionSortie);
          
          // Mettre à jour les informations du SRG2 pour l'affichage
          srg2.tensionEntree = regulationResult.tensionEntree;
          srg2.etatCommutateur = regulationResult.etatCommutateur;
          srg2.coefficientsAppliques = regulationResult.coefficientsAppliques;
          srg2.tensionSortie = regulationResult.tensionSortie;
        }
      }
      
      // Appliquer les modifications de tension aux nœuds en aval de chaque SRG2
      this.applyVoltageChangesToDownstreamNodes(workingNodes, project.cables, voltageChanges, project.loadModel);
      
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

    // Nettoyage des marqueurs SRG2 sur les nœuds de travail
    this.cleanupSRG2Markers(workingNodes);

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
   * Applique les changements de tension aux nœuds en aval
   * PROTECTION CONTRE MUTATION: utilise structuredClone pour éviter la corruption des IDs
   */
  private applyVoltageChangesToDownstreamNodes(
    nodes: Node[],
    cables: Cable[],
    voltageChanges: Map<string, {A: number, B: number, C: number}>,
    loadModel: string = 'polyphase_equilibre'
  ): void {
    
    console.log(`🔍 DIAGNOSTIC ID - Début applyVoltageChangesToDownstreamNodes`);
    console.log(`📋 IDs des nœuds avant modification:`, nodes.map(n => `${n.id} (type: ${typeof n.id})`));
    
    for (const [nodeId, newVoltages] of voltageChanges) {
      const nodeIndex = nodes.findIndex(n => n.id === nodeId);
      if (nodeIndex === -1) {
        console.error(`❌ Nœud ${nodeId} introuvable dans la liste des nœuds !`);
        continue;
      }

      // Diagnostic ID avant modification
      const originalId = nodes[nodeIndex].id;
      console.log(`🔍 DIAGNOSTIC ID - Nœud trouvé: ${originalId} (index: ${nodeIndex}, type: ${typeof originalId})`);

      // PROTECTION ANTI-MUTATION: Créer une copie profonde pour éviter la corruption des références
      const nodeBackup = {
        id: nodes[nodeIndex].id,
        name: nodes[nodeIndex].name
      };

      // Marquer ce nœud comme source locale SRG2 (sans muter l'ID)
      nodes[nodeIndex].isSRG2Source = true;
      nodes[nodeIndex].srg2OutputVoltage = structuredClone(newVoltages);

      // Diagnostic ID après marquage
      if (nodes[nodeIndex].id !== originalId) {
        console.error(`🚨 CORRUPTION ID DÉTECTÉE ! Original: ${originalId}, Actuel: ${nodes[nodeIndex].id}`);
        // Restaurer l'ID original si corrompu
        nodes[nodeIndex].id = originalId;
      }

      if (loadModel === 'monophase_reparti') {
        // Mode monophasé réparti: conserver les tensions par phase dans des propriétés spéciales
        (nodes[nodeIndex] as any).tensionCiblePhaseA = newVoltages.A;
        (nodes[nodeIndex] as any).tensionCiblePhaseB = newVoltages.B;
        (nodes[nodeIndex] as any).tensionCiblePhaseC = newVoltages.C;
        
        // Utiliser la moyenne pour tensionCible (compatibilité)
        const avgVoltage = (newVoltages.A + newVoltages.B + newVoltages.C) / 3;
        nodes[nodeIndex].tensionCible = avgVoltage;
        
        console.log(`🔧 SRG2 source locale sur nœud ${nodeId} (monophasé): tensions A=${newVoltages.A.toFixed(1)}V, B=${newVoltages.B.toFixed(1)}V, C=${newVoltages.C.toFixed(1)}V`);
      } else {
        // Mode polyphasé équilibré: utiliser la moyenne des trois phases
        const avgVoltage = (newVoltages.A + newVoltages.B + newVoltages.C) / 3;
        nodes[nodeIndex].tensionCible = avgVoltage;
        
        console.log(`🔧 SRG2 source locale sur nœud ${nodeId} (polyphasé): tension de sortie ${avgVoltage.toFixed(1)}V comme nouvelle source locale`);
      }
      
      // Validation finale de l'ID
      if (nodes[nodeIndex].id !== originalId) {
        console.error(`🚨 CORRUPTION ID FINALE ! Restauration...`);
        nodes[nodeIndex].id = originalId;
      }
      
      console.log(`🎯 Nœud ${nodeId} configuré comme source locale SRG2 (ID préservé: ${nodes[nodeIndex].id})`);
    }
    
    console.log(`🔍 DIAGNOSTIC ID - Fin applyVoltageChangesToDownstreamNodes`);
    console.log(`📋 IDs des nœuds après modification:`, nodes.map(n => `${n.id} (type: ${typeof n.id})`));
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
    console.log(`📋 IDs des nœuds avant nettoyage:`, nodes.map(n => `${n.id} (isSRG2Source: ${!!n.isSRG2Source})`));
    
    for (const node of nodes) {
      if (node.isSRG2Source) {
        // Sauvegarder l'ID original avant nettoyage
        const originalId = node.id;
        
        // Nettoyer les marqueurs SRG2
        node.isSRG2Source = undefined;
        node.srg2OutputVoltage = undefined;
        
        // Vérifier que l'ID n'a pas été corrompu pendant le nettoyage
        if (node.id !== originalId) {
          console.error(`🚨 CORRUPTION ID lors du nettoyage ! Original: ${originalId}, Actuel: ${node.id}`);
          node.id = originalId; // Restaurer l'ID
        }
        
        console.log(`🧹 Nettoyage marqueurs SRG2 pour nœud ${node.id} (ID préservé)`);
      }
    }
    
    console.log(`🔍 DIAGNOSTIC ID - Fin cleanupSRG2Markers`);
    console.log(`📋 IDs des nœuds après nettoyage:`, nodes.map(n => `${n.id} (isSRG2Source: ${!!n.isSRG2Source})`));
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