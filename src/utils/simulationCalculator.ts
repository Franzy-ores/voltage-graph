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

export class SimulationCalculator extends ElectricalCalculator {
  
  // Constantes de convergence séparées par type de tension
  private static readonly SIM_CONVERGENCE_TOLERANCE_PHASE_V = 0.1;  // Tension phase
  private static readonly SIM_CONVERGENCE_TOLERANCE_LINE_V = 0.17;   // Tension ligne (√3 × 0.1)
  private static readonly SIM_MAX_ITERATIONS = 100;
  private static readonly SIM_MAX_LOCAL_ITERATIONS = 50;
  private static readonly SIM_VOLTAGE_400V_THRESHOLD = 350;
  
  // Tensions de référence pour la déconnexion
  private static readonly PRODUCTION_DISCONNECT_VOLTAGE = 255;
  // Tolérance de convergence pour les tensions entre itérations (en volts)
  private static readonly CONVERGENCE_TOLERANCE_V = 0.01;
  
  private simCosPhi: number;
  
  // Cache pour les matrices d'impédance
  private impedanceMatrixCache = new Map<string, Complex[][]>();
  
  constructor(cosPhi: number = 0.95) {
    super(cosPhi);
    this.simCosPhi = Math.min(1, Math.max(0, cosPhi));
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
      // Mode forcé : calculer le baseline avec le déséquilibre calibré
      const { U1, U2, U3 } = project.forcedModeConfig.measuredVoltages;
      const U_moy = (U1 + U2 + U3) / 3;
      const U_dev_max = Math.max(
        Math.abs(U1 - U_moy),
        Math.abs(U2 - U_moy),
        Math.abs(U3 - U_moy)
      );
      const calculatedImbalance = (U_dev_max / U_moy) * 100;
      
      console.log(`Mode FORCÉ: baseline avec déséquilibre calibré = ${calculatedImbalance.toFixed(2)}%`);
      
      baselineResult = this.calculateScenario(
        project.nodes,
        project.cables,
        project.cableTypes,
        scenario,
        0, // foisonnements = 0 pour mode par phase
        0,
        project.transformerConfig,
        'monophase_reparti', // Forcer le mode par phase
        calculatedImbalance,
        project.manualPhaseDistribution
      );
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
      ...simulationResult.result,
      isSimulation: true,
      equipment,
      baselineResult,
      convergenceStatus: simulationResult.convergenceStatus
    };
  }

  /**
   * Calcule un scénario en intégrant les équipements de simulation dans l'algorithme BFS modifié
   */
  private calculateScenarioWithEquipment(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): { result: CalculationResult, convergenceStatus: 'converged' | 'not_converged' } {
    // Cloner les données pour ne pas modifier l'original
    let modifiedNodes = [...project.nodes];
    let modifiedCables = [...project.cables];
    let modifiedCableTypes = [...project.cableTypes];

    // Appliquer les améliorations de câbles si activées
    const activeUpgrades = equipment.cableUpgrades.filter(upgrade => 
      modifiedCables.some(c => c.id === upgrade.originalCableId)
    );

    for (const upgrade of activeUpgrades) {
      const cableIndex = modifiedCables.findIndex(c => c.id === upgrade.originalCableId);
      if (cableIndex >= 0) {
        modifiedCables[cableIndex] = {
          ...modifiedCables[cableIndex],
          typeId: upgrade.newCableTypeId
        };
      }
    }

    // Calculer le pourcentage de déséquilibre pour le mode FORCÉ
    let desequilibrePourcent: number;
    if (scenario === 'FORCÉ' && project.forcedModeConfig) {
      // Étape de calibration : Calculer le pourcentage de déséquilibre à partir des tensions mesurées
      const { U1, U2, U3 } = project.forcedModeConfig.measuredVoltages;
      const tensionMoyenne = (U1 + U2 + U3) / 3;
      const ecartMax = Math.max(
        Math.abs(U1 - tensionMoyenne),
        Math.abs(U2 - tensionMoyenne),
        Math.abs(U3 - tensionMoyenne)
      );

      desequilibrePourcent = (ecartMax / tensionMoyenne) * 100;

      // Limiter le pourcentage de déséquilibre pour la robustesse du modèle
      desequilibrePourcent = Math.min(Math.max(desequilibrePourcent, 0), 100);
      
      console.log(`Mode FORCÉ: déséquilibre calculé dynamiquement = ${desequilibrePourcent.toFixed(2)}% à partir des tensions [${U1}, ${U2}, ${U3}]V`);
    } else {
      // Pour les autres modes, utiliser le pourcentage de déséquilibre de la configuration du projet
      desequilibrePourcent = project.desequilibrePourcent || 0;
    }

    // Utiliser l'algorithme BFS modifié avec équipements de simulation
    const enhancedResult = this.runEnhancedBFS(
      modifiedNodes,
      modifiedCables,
      modifiedCableTypes,
      scenario,
      project.foisonnementCharges,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      desequilibrePourcent,
      project.manualPhaseDistribution,
      equipment
    );
    return enhancedResult;
  }

  /**
   * Répartit dynamiquement les charges et productions sur les phases selon les règles définies
   * et calcule automatiquement le déséquilibre pour le mode forcé
   */
  private distributeLoadsAndProductionsPerPhase(
    nodes: Node[],
    cosPhi: number,
    manualPhaseDistribution?: { charges: {A:number;B:number;C:number}; productions: {A:number;B:number;C:number}; constraints: {min:number;max:number;total:number} },
    scenario?: CalculationScenario,
    forcedModeConfig?: { measuredVoltages: { U1: number; U2: number; U3: number }, measurementNodeId: string }
  ): Map<string, { chargesPerPhase: Record<'A'|'B'|'C', {P_kW: number, Q_kVAr: number}>, productionsPerPhase: Record<'A'|'B'|'C', {P_kW: number, Q_kVAr: number}> }> {
    
    // Si mode forcé, calculer le déséquilibre automatiquement à partir des mesures
    let calculatedImbalance = 0;
    if (scenario === 'FORCÉ' && forcedModeConfig) {
      const { U1, U2, U3 } = forcedModeConfig.measuredVoltages;
      const U_moy = (U1 + U2 + U3) / 3;
      const U_dev_max = Math.max(
        Math.abs(U1 - U_moy),
        Math.abs(U2 - U_moy),
        Math.abs(U3 - U_moy)
      );
      calculatedImbalance = (U_dev_max / U_moy) * 100;
      console.log(`Mode FORCÉ: déséquilibre calculé = ${calculatedImbalance.toFixed(2)}% à partir des tensions [${U1}, ${U2}, ${U3}]V`);
    }

    const distributionMap = new Map<string, { 
      chargesPerPhase: Record<'A'|'B'|'C', {P_kW: number, Q_kVAr: number}>, 
      productionsPerPhase: Record<'A'|'B'|'C', {P_kW: number, Q_kVAr: number}> 
    }>();
    
    nodes.forEach(node => {
      const chargesPerPhase = { A: { P_kW: 0, Q_kVAr: 0 }, B: { P_kW: 0, Q_kVAr: 0 }, C: { P_kW: 0, Q_kVAr: 0 } };
      const productionsPerPhase = { A: { P_kW: 0, Q_kVAr: 0 }, B: { P_kW: 0, Q_kVAr: 0 }, C: { P_kW: 0, Q_kVAr: 0 } };
      
      // Répartir les charges selon la configuration manuelle ou aléatoirement
      if (node.clients && node.clients.length > 0) {
        const phases = ['A', 'B', 'C'] as const;
        const totalChargePower = node.clients.reduce((sum, client) => sum + (client.S_kVA || 0), 0);
        
        if (manualPhaseDistribution) {
          // Répartition manuelle selon les pourcentages définis
          const chargeRatios = manualPhaseDistribution.charges;
          phases.forEach(phase => {
            const power = totalChargePower * (chargeRatios[phase] / 100);
            const tanPhi = Math.tan(Math.acos(Math.min(1, Math.max(0, cosPhi))));
            chargesPerPhase[phase].P_kW += power * cosPhi;
            chargesPerPhase[phase].Q_kVAr += power * cosPhi * tanPhi;
          });
        } else {
          // Répartition aléatoire (comportement existant)
          node.clients.forEach(client => {
            const randomPhase = phases[Math.floor(Math.random() * 3)];
            const power = client.S_kVA || 0;
            const tanPhi = Math.tan(Math.acos(Math.min(1, Math.max(0, cosPhi))));
            chargesPerPhase[randomPhase].P_kW += power * cosPhi;
            chargesPerPhase[randomPhase].Q_kVAr += power * cosPhi * tanPhi;
          });
        }
      }
      
      // Répartir les productions selon la configuration manuelle ou les règles existantes
      if (node.productions && node.productions.length > 0) {
        const phases = ['A', 'B', 'C'] as const;
        const totalProductionPower = node.productions.reduce((sum, prod) => sum + (prod.S_kVA || 0), 0);
        
        if (manualPhaseDistribution) {
          // Répartition manuelle selon les pourcentages définis
          const productionRatios = manualPhaseDistribution.productions;
          phases.forEach(phase => {
            const power = totalProductionPower * (productionRatios[phase] / 100);
            productionsPerPhase[phase].P_kW += power;
            // Production avec facteur de puissance unitaire (Q = 0)
          });
        } else {
          // Répartition selon les règles existantes (≤5kVA = mono, >5kVA = tri)
          node.productions.forEach(production => {
            const power = production.S_kVA || 0;
            if (power <= 5) {
              // Monophasé - assigner à une phase aléatoire
              const randomPhase = phases[Math.floor(Math.random() * 3)];
              productionsPerPhase[randomPhase].P_kW += power;
              // Production avec facteur de puissance unitaire (Q = 0)
            } else {
              // Triphasé - répartir équitablement sur les trois phases
              const powerPerPhase = power / 3;
              productionsPerPhase.A.P_kW += powerPerPhase;
              productionsPerPhase.B.P_kW += powerPerPhase;
              productionsPerPhase.C.P_kW += powerPerPhase;
              // Production avec facteur de puissance unitaire (Q = 0)
            }
          });
        }
      }
      
      distributionMap.set(node.id, { chargesPerPhase, productionsPerPhase });
    });
    
    return distributionMap;
  }

  /**
   * BFS modifié pour intégrer les équipements de simulation avec boucle de convergence
   * et déconnexion automatique des productions
   */
  private runEnhancedBFS(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario,
    foisonnementCharges: number,
    foisonnementProductions: number,
    transformerConfig: TransformerConfig | null,
    loadModel: LoadModel,
    desequilibrePourcent: number,
    manualPhaseDistribution: { charges: {A:number;B:number;C:number}; productions: {A:number;B:number;C:number}; constraints: {min:number;max:number;total:number} } | undefined,
    equipment: SimulationEquipment
  ): { result: CalculationResult, convergenceStatus: 'converged' | 'not_converged' } {
    
    const maxIterations = SimulationCalculator.SIM_MAX_ITERATIONS;
    let simulationConverged = false;
    let iteration = 0;
    
    // Structures pour le graphe et les calculs
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const adjacency = this.buildAdjacencyMap(nodes, cables);
    const treeStructure = this.buildTreeStructure(nodes, cables, adjacency);
    
    // État des équipements à chaque itération
    const regulatorStates = new Map<string, { Q_kVAr: number, V_target: number, isLimited: boolean }>();
    const compensatorStates = new Map<string, { S_virtual_kVA: number, IN_A: number, reductionPercent: number, isLimited: boolean }>();
    
    // Initialisation des états
    for (const [nodeId, regulator] of equipment.regulators.filter(r => r.enabled).map(r => [r.nodeId, r])) {
      regulatorStates.set(nodeId, { Q_kVAr: 0, V_target: equipment.regulators.find(r => r.nodeId === nodeId)!.targetVoltage_V, isLimited: false });
    }
    for (const [nodeId, _compensator] of equipment.neutralCompensators.filter(c => c.enabled).map(c => [c.nodeId, c])) {
      compensatorStates.set(nodeId, { S_virtual_kVA: 0, IN_A: 0, reductionPercent: 0, isLimited: false });
    }
    
    // Tensions précédentes pour convergence
    let tensionsBefore: { nodeId: string; u1: number; u2: number; u3: number }[] = [];
    let currentResult: CalculationResult;
    
    // Générer la distribution dynamique des charges et productions par phase une seule fois
    const phaseDistribution = this.distributeLoadsAndProductionsPerPhase(nodes, this.simCosPhi, manualPhaseDistribution);
    
    // Cloner les nodes pour pouvoir modifier les productions lors de la déconnexion
    let workingNodes = nodes.map(node => ({
      ...node,
      productions: node.productions.map(prod => ({ ...prod }))
    }));

    // Calculer le desequilibrePourcent AVANT la boucle (mode FORCÉ)
    if (scenario === 'FORCÉ') {
      // Le desequilibrePourcent a déjà été calculé avant l'appel de cette méthode
      console.log(`Mode FORCÉ: Démarrage simulation avec déséquilibre ${desequilibrePourcent.toFixed(2)}%`);
    }

    // Boucle de convergence avec déconnexion des productions
    for (let i = 0; i < maxIterations; i++) {
      iteration = i + 1;
      console.log(`🔄 Simulation iteration ${iteration}`);
      
      // Exécuter le calcul de flux de puissance pour l'itération
      const modifiedNodes = this.applyEquipmentToNodes(workingNodes, regulatorStates, compensatorStates);
      
      const nodesWithPhaseDistribution = modifiedNodes.map(node => {
        const distribution = phaseDistribution.get(node.id);
        if (distribution) {
          return { ...node, phaseDistribution: distribution };
        }
        return node;
      });
      
      currentResult = this.calculateScenario(
        nodesWithPhaseDistribution, cables, cableTypes, scenario,
        0, // foisonnementCharges = 0 pour utiliser la distribution exacte
        0, // foisonnementProductions = 0 pour utiliser la distribution exacte
        transformerConfig, loadModel, 1, // desequilibrePourcent = 1 pour activer le mode par phase
        manualPhaseDistribution
      );

      // Initialiser le drapeau pour la stabilité de la production
      let productionDisconnectedThisIteration = false;

      // Vérification de la tension et déconnexion des productions
      if (currentResult.nodeMetrics) {
        for (const nodeMetric of currentResult.nodeMetrics) {
          const node = workingNodes.find(n => n.id === nodeMetric.nodeId);
          if (node && node.productions.length > 0) {
            // Identifier les productions à déconnecter
            let maxVoltage = nodeMetric.V_phase_V;
            
            // Si on a les détails par phase, utiliser le maximum
            if (currentResult.nodePhasorsPerPhase) {
              const phasorsA = currentResult.nodePhasorsPerPhase.find(p => p.nodeId === node.id && p.phase === 'A');
              const phasorsB = currentResult.nodePhasorsPerPhase.find(p => p.nodeId === node.id && p.phase === 'B');
              const phasorsC = currentResult.nodePhasorsPerPhase.find(p => p.nodeId === node.id && p.phase === 'C');
              
              if (phasorsA && phasorsB && phasorsC) {
                maxVoltage = Math.max(phasorsA.V_phase_V, phasorsB.V_phase_V, phasorsC.V_phase_V);
              }
            }

            if (maxVoltage > SimulationCalculator.PRODUCTION_DISCONNECT_VOLTAGE) {
              console.log(`⚠️ Déconnexion production noeud ${node.id}: tension ${maxVoltage.toFixed(1)}V > ${SimulationCalculator.PRODUCTION_DISCONNECT_VOLTAGE}V`);
              // Mettre la puissance de production à zéro pour le prochain cycle
              node.productions.forEach(prod => prod.S_kVA = 0);
              productionDisconnectedThisIteration = true;
            }
          }
        }
      }

      // Vérifier la convergence des tensions
      let tensionsStable = true;
      if (i > 0) {
        // Comparer avec les tensions de l'itération précédente
        if (currentResult.nodeMetrics) {
          for (const nodeMetric of currentResult.nodeMetrics) {
            const previousTension = tensionsBefore.find(t => t.nodeId === nodeMetric.nodeId);
            if (previousTension) {
              let currentVoltages = { u1: nodeMetric.V_phase_V, u2: nodeMetric.V_phase_V, u3: nodeMetric.V_phase_V };
              
              // Si on a les détails par phase, les utiliser
              if (currentResult.nodePhasorsPerPhase) {
                const phasorsA = currentResult.nodePhasorsPerPhase.find(p => p.nodeId === nodeMetric.nodeId && p.phase === 'A');
                const phasorsB = currentResult.nodePhasorsPerPhase.find(p => p.nodeId === nodeMetric.nodeId && p.phase === 'B');
                const phasorsC = currentResult.nodePhasorsPerPhase.find(p => p.nodeId === nodeMetric.nodeId && p.phase === 'C');
                
                if (phasorsA && phasorsB && phasorsC) {
                  currentVoltages = { u1: phasorsA.V_phase_V, u2: phasorsB.V_phase_V, u3: phasorsC.V_phase_V };
                }
              }

              const deltaU1 = Math.abs(currentVoltages.u1 - previousTension.u1);
              const deltaU2 = Math.abs(currentVoltages.u2 - previousTension.u2);
              const deltaU3 = Math.abs(currentVoltages.u3 - previousTension.u3);
              
              if (deltaU1 > SimulationCalculator.CONVERGENCE_TOLERANCE_V || 
                  deltaU2 > SimulationCalculator.CONVERGENCE_TOLERANCE_V || 
                  deltaU3 > SimulationCalculator.CONVERGENCE_TOLERANCE_V) {
                tensionsStable = false;
                break;
              }
            }
          }
        }
      }
      
      // Sauvegarder les tensions pour la prochaine itération
      tensionsBefore = [];
      if (currentResult.nodeMetrics) {
        for (const nodeMetric of currentResult.nodeMetrics) {
          let voltages = { u1: nodeMetric.V_phase_V, u2: nodeMetric.V_phase_V, u3: nodeMetric.V_phase_V };
          
          if (currentResult.nodePhasorsPerPhase) {
            const phasorsA = currentResult.nodePhasorsPerPhase.find(p => p.nodeId === nodeMetric.nodeId && p.phase === 'A');
            const phasorsB = currentResult.nodePhasorsPerPhase.find(p => p.nodeId === nodeMetric.nodeId && p.phase === 'B');
            const phasorsC = currentResult.nodePhasorsPerPhase.find(p => p.nodeId === nodeMetric.nodeId && p.phase === 'C');
            
            if (phasorsA && phasorsB && phasorsC) {
              voltages = { u1: phasorsA.V_phase_V, u2: phasorsB.V_phase_V, u3: phasorsC.V_phase_V };
            }
          }
          
          tensionsBefore.push({ nodeId: nodeMetric.nodeId, ...voltages });
        }
      }

      // Conditions de sortie de la boucle
      if (tensionsStable && !productionDisconnectedThisIteration) {
        simulationConverged = true;
        console.log(`✅ Simulation convergée à l'itération ${iteration}`);
        break;
      }

      // Si on n'est pas encore convergé, traiter les équipements pour l'itération suivante
      if (i < maxIterations - 1) {
        this.processEquipmentIteration(workingNodes, cables, cableTypes, scenario, transformerConfig, loadModel, manualPhaseDistribution, equipment.regulators.reduce((m, r) => { if (r.enabled) m.set(r.nodeId, r); return m; }, new Map()), equipment.neutralCompensators.reduce((m, c) => { if (c.enabled) m.set(c.nodeId, c); return m; }, new Map()), regulatorStates, compensatorStates, phaseDistribution, currentResult, foisonnementCharges, foisonnementProductions, desequilibrePourcent);
      }
    }

    if (!simulationConverged) {
      console.warn(`⚠️ Simulation non convergée après ${maxIterations} itérations`);
    } else {
      console.log(`✅ Simulation convergée en ${iteration} itérations`);
    }

    // Appliquer les effets des compensateurs et finaliser
    this.finalizeSimulationResult(workingNodes, cables, cableTypes, equipment.neutralCompensators.reduce((m, c) => { if (c.enabled) m.set(c.nodeId, c); return m; }, new Map()), equipment.regulators.reduce((m, r) => { if (r.enabled) m.set(r.nodeId, r); return m; }, new Map()), regulatorStates, compensatorStates, currentResult);

    return {
      result: currentResult,
      convergenceStatus: simulationConverged ? 'converged' : 'not_converged'
    };
  }

  private processEquipmentIteration(
    workingNodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario,
    transformerConfig: TransformerConfig | null,
    loadModel: LoadModel,
    manualPhaseDistribution: any,
    regulators: Map<string, VoltageRegulator>,
    compensators: Map<string, NeutralCompensator>,
    regulatorStates: Map<string, any>,
    compensatorStates: Map<string, any>,
    phaseDistribution: Map<string, any>,
    currentResult: CalculationResult,
    foisonnementCharges: number,
    foisonnementProductions: number,
    desequilibrePourcent: number
  ) {
    let equipmentChanged = false;
    
    // Traiter les régulateurs
    let maxQDelta = 0;
    for (const [nodeId, regulator] of regulators.entries()) {
      const node = workingNodes.find(n => n.id === nodeId);
      if (!node) continue;

      const baseV_line = this.getNodeLineVoltageFromResult(currentResult, node, workingNodes);
      const targetV = regulator.targetVoltage_V;
      const state = regulatorStates.get(nodeId)!;

      // Test de sensibilité avec ΔQ = +1 kVAr
      const deltaQtest = 1;
      const testRegulatorStates = new Map(regulatorStates);
      const testState = { ...state, Q_kVAr: state.Q_kVAr + deltaQtest };
      testRegulatorStates.set(nodeId, testState);

      const testNodes = this.applyEquipmentToNodes(workingNodes, testRegulatorStates, compensatorStates);
      const testNodesWithPhaseDistribution = testNodes.map(node => {
        const distribution = phaseDistribution.get(node.id);
        if (distribution) {
          return { ...node, phaseDistribution: distribution };
        }
        return node;
      });
      
      const testResult = this.calculateScenario(
        testNodesWithPhaseDistribution, cables, cableTypes, scenario,
        0, 0, transformerConfig, loadModel, 1, manualPhaseDistribution
      );
      const testV_line = this.getNodeLineVoltageFromResult(testResult, node, workingNodes);

      // Calcul de sensibilité
      let sensitivity = (testV_line - baseV_line) / deltaQtest;
      if (!isFinite(sensitivity) || Math.abs(sensitivity) < 1e-6) {
        sensitivity = 0.05;
      }

      // Correction de Q
      const deltaV = targetV - baseV_line;
      let deltaQ = deltaV / sensitivity;
      const maxStep = Math.max(2, regulator.maxPower_kVA * 0.25);
      deltaQ = Math.max(-maxStep, Math.min(maxStep, deltaQ));

      const newQ = Math.max(-regulator.maxPower_kVA, Math.min(regulator.maxPower_kVA, state.Q_kVAr + deltaQ));
      const qChange = Math.abs(newQ - state.Q_kVAr);
      if (qChange > 0.05) {
        state.Q_kVAr = newQ;
        state.isLimited = Math.abs(newQ) >= regulator.maxPower_kVA;
        equipmentChanged = true;
      }
      if (qChange > maxQDelta) maxQDelta = qChange;
    }
    
    // Traiter les compensateurs
    for (const [nodeId, compensator] of compensators.entries()) {
      const currentState = compensatorStates.get(nodeId)!;
      const hadNonZero = Math.abs(currentState.S_virtual_kVA) > 0.001;
      currentState.S_virtual_kVA = 0;
      currentState.IN_A = 0;
      currentState.reductionPercent = 0;
      currentState.isLimited = false;
      if (hadNonZero) equipmentChanged = true;
    }
    
    // Recalcul si équipements changés
    if (equipmentChanged) {
      const finalModifiedNodes = this.applyEquipmentToNodes(workingNodes, regulatorStates, compensatorStates);
      // Note: currentResult sera mis à jour dans la boucle principale
    }
  }

  private finalizeSimulationResult(
    workingNodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    compensators: Map<string, NeutralCompensator>,
    regulators: Map<string, VoltageRegulator>,
    regulatorStates: Map<string, any>,
    compensatorStates: Map<string, any>,
    currentResult: CalculationResult
  ) {
    // Appliquer les effets des compensateurs EQUI8
    for (const [nodeId, compensator] of compensators.entries()) {
      if (compensator.enabled && currentResult.nodeMetrics) {
        const nodeMetric = currentResult.nodeMetrics.find(m => m.nodeId === nodeId);
        if (!nodeMetric) continue;

        const { uA, uB, uC } = this.calculateEqui8Effect(nodeMetric, compensator);

        // Mettre à jour les résultats
        if (currentResult.nodePhasorsPerPhase) {
          const updatePhase = (phase: 'A' | 'B' | 'C', mag: number) => {
            const p = currentResult.nodePhasorsPerPhase!.find(pp => pp.nodeId === nodeId && pp.phase === phase);
            if (p) p.V_phase_V = mag;
          };
          updatePhase('A', uA);
          updatePhase('B', uB);
          updatePhase('C', uC);
        }

        if (currentResult.nodeMetrics) {
          const midx = currentResult.nodeMetrics.findIndex(m => m.nodeId === nodeId);
          if (midx >= 0) {
            currentResult.nodeMetrics[midx] = {
              ...currentResult.nodeMetrics[midx],
              V_phase_V: (uA + uB + uC) / 3,
            };
          }
        }

        compensator.u1p_V = uA;
        compensator.u2p_V = uB;
        compensator.u3p_V = uC;

        this.propagateVoltagesDownstream(nodeId, { A: uA, B: uB, C: uC }, workingNodes, cables, cableTypes, currentResult);
      }
    }

    // Mise à jour des résultats dans les équipements
    this.updateEquipmentResults(regulators, regulatorStates, compensators, compensatorStates);

    // Mise à jour des tensions mesurées pour les régulateurs
    for (const [nodeId, regulator] of regulators.entries()) {
      const node = workingNodes.find(n => n.id === nodeId);
      if (node) {
        regulator.currentVoltage_V = this.getNodeLineVoltageFromResult(currentResult, node, workingNodes);
      }
    }
  }

  private buildAdjacencyMap(nodes: Node[], cables: Cable[]): Map<string, string[]> {
    const adjacency = new Map<string, string[]>();
    
    // Initialiser tous les nœuds
    nodes.forEach(node => {
      adjacency.set(node.id, []);
    });
    
    // Ajouter les connexions
    cables.forEach(cable => {
      const neighbors1 = adjacency.get(cable.nodeAId) || [];
      const neighbors2 = adjacency.get(cable.nodeBId) || [];
      
      neighbors1.push(cable.nodeBId);
      neighbors2.push(cable.nodeAId);
      
      adjacency.set(cable.nodeAId, neighbors1);
      adjacency.set(cable.nodeBId, neighbors2);
    });
    
    return adjacency;
  }

  private buildTreeStructure(nodes: Node[], cables: Cable[], adjacency: Map<string, string[]>): Map<string, { parent: string | null; children: string[] }> {
    const treeStructure = new Map<string, { parent: string | null; children: string[] }>();
    
    // Trouver le nœud racine (source)
    const rootNode = nodes.find(n => n.isSource) || nodes[0];
    if (!rootNode) return treeStructure;
    
    // BFS pour construire l'arbre
    const visited = new Set<string>();
    const queue: { nodeId: string, parent: string | null }[] = [];
    
    queue.push({ nodeId: rootNode.id, parent: null });
    visited.add(rootNode.id);
    
    while (queue.length > 0) {
      const { nodeId, parent } = queue.shift()!;
      
      const children: string[] = [];
      const neighbors = adjacency.get(nodeId) || [];
      
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          children.push(neighborId);
          queue.push({ nodeId: neighborId, parent: nodeId });
        }
      }
      
      treeStructure.set(nodeId, { parent, children });
    }
    
    return treeStructure;
  }

  private propagateVoltagesDownstream(
    sourceNodeId: string, 
    sourceVoltages: { A: number; B: number; C: number },
    nodes: Node[], 
    cables: Cable[], 
    cableTypes: CableType[],
    result: CalculationResult
  ): void {
    console.log(`🔄 Propagating voltages from compensator ${sourceNodeId}:`, sourceVoltages);
    
    // Créer un graphe des connexions
    const nodeConnections = new Map<string, { cable: Cable; otherNodeId: string }[]>();
    
    for (const cable of cables) {
      const connections1 = nodeConnections.get(cable.nodeAId) || [];
      const connections2 = nodeConnections.get(cable.nodeBId) || [];
      
      connections1.push({ cable, otherNodeId: cable.nodeBId });
      connections2.push({ cable, otherNodeId: cable.nodeAId });
      
      nodeConnections.set(cable.nodeAId, connections1);
      nodeConnections.set(cable.nodeBId, connections2);
    }

    // BFS pour propager les tensions
    const visited = new Set<string>();
    const queue: { nodeId: string; voltages: { A: number; B: number; C: number } }[] = [];
    
    // Commencer par le nœud compensateur
    queue.push({ nodeId: sourceNodeId, voltages: sourceVoltages });
    visited.add(sourceNodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const connections = nodeConnections.get(current.nodeId) || [];
      
      for (const { cable, otherNodeId } of connections) {
        if (visited.has(otherNodeId)) continue;
        
        // Calculer les nouvelles tensions au nœud en aval
        const newVoltages = this.calculateDownstreamVoltages(
          current.voltages, 
          cable, 
          current.nodeId === cable.nodeAId, // true si on va de A vers B
          nodes, 
          cableTypes
        );
        
        // Mettre à jour les résultats
        this.updateNodeVoltagesInResult(otherNodeId, newVoltages, result);
        
        // Continuer la propagation
        visited.add(otherNodeId);
        queue.push({ nodeId: otherNodeId, voltages: newVoltages });
        
        console.log(`  → Node ${otherNodeId}: A=${newVoltages.A.toFixed(1)}V, B=${newVoltages.B.toFixed(1)}V, C=${newVoltages.C.toFixed(1)}V`);
      }
    }
  }

  private calculateDownstreamVoltages(
    upstreamVoltages: { A: number; B: number; C: number },
    cable: Cable,
    isForwardDirection: boolean,
    nodes: Node[],
    cableTypes: CableType[]
  ): { A: number; B: number; C: number } {
    const cableType = cableTypes.find(t => t.id === cable.typeId);
    if (!cableType) return upstreamVoltages;

    // Récupérer les nœuds
    const nodeA = nodes.find(n => n.id === cable.nodeAId);
    const nodeB = nodes.find(n => n.id === cable.nodeBId);
    if (!nodeA || !nodeB) return upstreamVoltages;

    // Calculer les courants (approximation basée sur les charges des nœuds)
    const targetNode = isForwardDirection ? nodeB : nodeA;
    const totalLoad = (targetNode.clients || []).reduce((sum, charge) => sum + charge.S_kVA, 0);
    const totalProd = (targetNode.productions || []).reduce((sum, prod) => sum + prod.S_kVA, 0);
    const netLoad = Math.max(0, totalLoad - totalProd); // kVA

    // Courant approximatif par phase (réparti uniformément)
    const current_A = netLoad > 0 ? netLoad * 1000 / (3 * 230) : 0; // A par phase approximatif

    // Résistance et réactance du câble
    const R_ohm = cableType.R12_ohm_per_km * (cable.length_m || 0) / 1000;
    const X_ohm = cableType.X12_ohm_per_km * (cable.length_m || 0) / 1000;

    // Chute de tension par phase: ΔU = I × (R + jX) ≈ I × R (approximation résistive)
    const voltageDrop = current_A * R_ohm;

    // Appliquer la chute (négative si on va dans le sens du courant)
    const dropSign = isForwardDirection ? -1 : 1;
    
    return {
      A: upstreamVoltages.A + dropSign * voltageDrop,
      B: upstreamVoltages.B + dropSign * voltageDrop,  
      C: upstreamVoltages.C + dropSign * voltageDrop
    };
  }

  private updateNodeVoltagesInResult(
    nodeId: string, 
    voltages: { A: number; B: number; C: number }, 
    result: CalculationResult
  ): void {
    // Mettre à jour nodeMetricsPerPhase
    if (result.nodeMetricsPerPhase) {
      const idx = result.nodeMetricsPerPhase.findIndex(m => m.nodeId === nodeId);
      if (idx >= 0) {
        result.nodeMetricsPerPhase[idx] = {
          ...result.nodeMetricsPerPhase[idx],
          voltagesPerPhase: voltages,
        };
      } else {
        result.nodeMetricsPerPhase.push({
          nodeId,
          voltagesPerPhase: voltages,
          voltageDropsPerPhase: { A: 0, B: 0, C: 0 },
        });
      }
    }

    // Mettre à jour nodePhasorsPerPhase si présent
    if (result.nodePhasorsPerPhase) {
      const updatePhase = (phase: 'A' | 'B' | 'C', mag: number) => {
        const p = result.nodePhasorsPerPhase!.find(pp => pp.nodeId === nodeId && pp.phase === phase);
        if (p) p.V_phase_V = mag;
      };
      updatePhase('A', voltages.A);
      updatePhase('B', voltages.B);
      updatePhase('C', voltages.C);
    }

    // Mettre à jour la métrique agrégée (moyenne)
    if (result.nodeMetrics) {
      const midx = result.nodeMetrics.findIndex(m => m.nodeId === nodeId);
      if (midx >= 0) {
        result.nodeMetrics[midx] = {
          ...result.nodeMetrics[midx],
          V_phase_V: (voltages.A + voltages.B + voltages.C) / 3,
        };
      }
    }
  }

  private applyEquipmentToNodes(
    nodes: Node[],
    regulatorStates: Map<string, { Q_kVAr: number, V_target: number, isLimited: boolean }>,
    compensatorStates: Map<string, { S_virtual_kVA: number, IN_A: number, reductionPercent: number, isLimited: boolean }>
  ): Node[] {
    return nodes.map(node => {
      const regulatorState = regulatorStates.get(node.id);
      const compensatorState = compensatorStates.get(node.id);
      
      if (!regulatorState && !compensatorState) {
        return node;
      }
      
      const modifiedNode = { ...node };
      
      // Appliquer les régulateurs (injection de puissance réactive)
      if (regulatorState && Math.abs(regulatorState.Q_kVAr) > 0.001) {
        // Créer une production virtuelle pour injecter la puissance réactive
        const virtualProduction = {
          id: `regulator_${node.id}`,
          name: 'Régulateur de tension',
          label: 'Régulateur de tension',
          S_kVA: Math.abs(regulatorState.Q_kVAr), // Magnitude
          cosPhi: 0, // Puissance purement réactive
          type: 'AUTRE' as const
        };
        
        modifiedNode.productions = [...(node.productions || []), virtualProduction];
      }
      
      // Appliquer les compensateurs (charge virtuelle si nécessaire)
      if (compensatorState && Math.abs(compensatorState.S_virtual_kVA) > 0.001) {
        const virtualLoad = {
          id: `compensator_${node.id}`,
          name: 'Compensateur de neutre',
          label: 'Compensateur de neutre',
          S_kVA: compensatorState.S_virtual_kVA,
          cosPhi: 0.95,
          type: 'AUTRE' as const
        };
        
        modifiedNode.clients = [...(node.clients || []), virtualLoad];
      }
      
      return modifiedNode;
    });
  }

  private updateEquipmentResults(
    regulators: Map<string, VoltageRegulator>,
    regulatorStates: Map<string, { Q_kVAr: number, V_target: number, isLimited: boolean }>,
    compensators: Map<string, NeutralCompensator>,
    compensatorStates: Map<string, { S_virtual_kVA: number, IN_A: number, reductionPercent: number, isLimited: boolean }>
  ): void {
    // Mise à jour des régulateurs
    for (const [nodeId, regulator] of regulators.entries()) {
      const state = regulatorStates.get(nodeId);
      if (state) {
        regulator.currentQ_kVAr = state.Q_kVAr;
        regulator.isLimited = state.isLimited;
      }
    }
    
    // Mise à jour des compensateurs
    for (const [nodeId, compensator] of compensators.entries()) {
      const state = compensatorStates.get(nodeId);
      if (state) {
        compensator.currentIN_A = state.IN_A;
        compensator.reductionPercent = state.reductionPercent;
        compensator.isLimited = state.isLimited;
      }
    }
  }

  private getNodeLineVoltageFromResult(result: CalculationResult, node: Node, allNodes: Node[]): number {
    // Chercher d'abord dans les métriques par phase
    const perPhaseMetric = result.nodeMetricsPerPhase?.find(m => m.nodeId === node.id);
    if (perPhaseMetric) {
      const { A, B, C } = perPhaseMetric.voltagesPerPhase;
      // Calculer la tension ligne moyenne: U_ligne = √3 × U_phase_moyenne
      const avgPhaseVoltage = (A + B + C) / 3;
      return avgPhaseVoltage * Math.sqrt(3);
    }
    
    // Fallback sur les métriques standard
    const metric = result.nodeMetrics?.find(m => m.nodeId === node.id);
    if (metric) {
      // Si c'est déjà une tension ligne, la retourner directement
      // Sinon, convertir de phase à ligne
      const voltage = metric.V_phase_V;
      // Heuristique: si > 350V, c'est probablement déjà une tension ligne
      return voltage > SimulationCalculator.SIM_VOLTAGE_400V_THRESHOLD ? voltage : voltage * Math.sqrt(3);
    }
    
    // Fallback final
    return 400; // Valeur par défaut
  }

  private calculateEqui8Effect(initialVoltages: number | { V_phase_V: number }, compensator: NeutralCompensator): { uA: number; uB: number; uC: number } {
    let u1: number, u2: number, u3: number;
    if (typeof initialVoltages === 'number') {
      u1 = u2 = u3 = initialVoltages;
    } else if ('V_phase_V' in initialVoltages) {
      u1 = u2 = u3 = initialVoltages.V_phase_V;
    } else {
      u1 = u2 = u3 = 230;
    }
    
    // Calcul du courant de neutre selon le modèle EQUI8
    const uMoy = (u1 + u2 + u3) / 3;
    const deltaU1 = u1 - uMoy;
    const deltaU2 = u2 - uMoy;
    const deltaU3 = u3 - uMoy;
    
    const Zp = Math.max(1e-9, compensator.phaseImpedance ?? compensator.zPhase_Ohm ?? 1e-9);
    
    // Courant de neutre (somme vectorielle des déséquilibres)
    const iNeutre = Math.sqrt(deltaU1 * deltaU1 + deltaU2 * deltaU2 + deltaU3 * deltaU3) / (3 * Zp);
    
    // Correction des tensions (effet de rééquilibrage)
    const correctionFactor = Math.min(1, iNeutre * Zp / (uMoy * 0.1)); // Limitation à 10% de correction
    
    const u1Corrected = u1 - deltaU1 * correctionFactor * 0.8; // 80% d'efficacité
    const u2Corrected = u2 - deltaU2 * correctionFactor * 0.8;
    const u3Corrected = u3 - deltaU3 * correctionFactor * 0.8;
    
    return { uA: u1Corrected, uB: u2Corrected, uC: u3Corrected };
  }

  createDefaultRegulator(nodeId: string, voltageSystem?: VoltageSystem): VoltageRegulator {
    return {
      id: `reg_${nodeId}`,
      nodeId,
      type: 'STATIC' as RegulatorType,
      enabled: false,
      targetVoltage_V: voltageSystem === "TÉTRAPHASÉ_400V" ? 400 : 230,
      maxPower_kVA: 50,
      currentVoltage_V: 0,
      currentQ_kVAr: 0,
      isLimited: false
    };
  }

  proposeFullCircuitReinforcement(project: Project, result: CalculationResult, threshold: number = 8.0): CableUpgrade[] {
    const upgrades: CableUpgrade[] = [];
    
    // Trouver le type de câble le plus robuste
    const bestCableType = project.cableTypes.reduce((best, current) => 
      (current.maxCurrent_A || 0) > (best.maxCurrent_A || 0) ? current : best
    );

    // Proposer des améliorations pour tous les câbles avec problèmes
    project.cables.forEach(cable => {
      // Vérifier si le câble a des problèmes de chute de tension
      const hasVoltageIssue = (cable.voltageDropPercent || 0) > threshold;
      const hasOverload = (cable.current_A || 0) > ((project.cableTypes.find(t => t.id === cable.typeId)?.maxCurrent_A || 1000));
      
      if ((hasVoltageIssue || hasOverload) && cable.typeId !== bestCableType.id) {
        const currentType = project.cableTypes.find(t => t.id === cable.typeId);
        
        upgrades.push({
          originalCableId: cable.id,
          newCableTypeId: bestCableType.id,
          reason: hasVoltageIssue && hasOverload ? 'both' : hasVoltageIssue ? 'voltage_drop' : 'overload',
          before: {
            voltageDropPercent: cable.voltageDropPercent || 0,
            current_A: cable.current_A || 0,
            losses_kW: 0 // Simplifié pour l'instant
          },
          after: {
            voltageDropPercent: Math.max(0, (cable.voltageDropPercent || 0) * 0.5), // Estimation
            current_A: cable.current_A || 0,
            losses_kW: 0, // Simplifié pour l'instant
            estimatedCost: 1000
          },
          improvement: {
            voltageDropReduction: (cable.voltageDropPercent || 0) * 0.5,
            lossReduction_kW: 0,
            lossReductionPercent: 0
          }
        });
      }
    });

    return upgrades;
  }
}
