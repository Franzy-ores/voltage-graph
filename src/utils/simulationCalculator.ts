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
  ConnectionType
} from '@/types/network';
import { ElectricalCalculator } from '@/utils/electricalCalculations';
import { Complex, C, add, sub, mul, div, abs, fromPolar } from '@/utils/complex';

export class SimulationCalculator extends ElectricalCalculator {
  
  private convergenceTolerance = 0.1; // 0.1V pour tous les tests
  private simCosPhi: number;
  
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
    const baselineResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      scenario,
      project.foisonnementCharges,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent
    );

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
      baselineResult
    };
  }

  /**
   * Calcule un scénario en intégrant les équipements de simulation dans l'algorithme BFS modifié
   */
  private calculateScenarioWithEquipment(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): CalculationResult {
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

    // Utiliser l'algorithme BFS modifié avec équipements de simulation
    return this.calculateScenarioWithEnhancedBFS(
      modifiedNodes,
      modifiedCables,
      modifiedCableTypes,
      scenario,
      project.foisonnementCharges,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent,
      equipment
    );
  }

  /**
   * Algorithme BFS modifié avec intégration native des équipements de simulation
   */
  private calculateScenarioWithEnhancedBFS(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario,
    foisonnementCharges: number,
    foisonnementProductions: number,
    transformerConfig: TransformerConfig | null,
    loadModel: LoadModel,
    desequilibrePourcent: number,
    equipment: SimulationEquipment
  ): CalculationResult {
    // Extraire les équipements actifs
    const activeRegulators = equipment.regulators.filter(r => r.enabled);
    const activeCompensators = equipment.neutralCompensators.filter(c => c.enabled);
    
    // Créer maps pour accès rapide
    const regulatorByNode = new Map(activeRegulators.map(r => [r.nodeId, r]));
    const compensatorByNode = new Map(activeCompensators.map(c => [c.nodeId, c]));
    
    // Si aucun équipement actif, utiliser l'algorithme standard
    if (activeRegulators.length === 0 && activeCompensators.length === 0) {
      return this.calculateScenario(
        nodes, cables, cableTypes, scenario,
        foisonnementCharges, foisonnementProductions, 
        transformerConfig, loadModel, desequilibrePourcent
      );
    }

    // Algorithme BFS modifié avec équipements
    return this.runEnhancedBFS(
      nodes, cables, cableTypes, scenario,
      foisonnementCharges, foisonnementProductions,
      transformerConfig, loadModel, desequilibrePourcent,
      regulatorByNode, compensatorByNode
    );
  }

  /**
   * BFS modifié pour intégrer les équipements de simulation avec vraie convergence
   * et recalcul des nœuds aval pour chaque régulateur
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
    regulators: Map<string, VoltageRegulator>,
    compensators: Map<string, NeutralCompensator>
  ): CalculationResult {
    
    const maxIterations = 20;
    let converged = false;
    let iteration = 0;
    let maxVoltageDelta = 0;
    
    // Structures pour le graphe et les calculs
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const adjacency = this.buildAdjacencyMap(nodes, cables);
    const treeStructure = this.buildTreeStructure(nodes, cables, adjacency);
    
    // État des équipements à chaque itération
    const regulatorStates = new Map<string, { Q_kVAr: number, V_target: number, isLimited: boolean }>();
    const compensatorStates = new Map<string, { Q_phases: { A: number, B: number, C: number }, IN_A: number, reductionPercent: number, isLimited: boolean }>();
    
    // Initialisation des états
    for (const [nodeId, regulator] of regulators.entries()) {
      regulatorStates.set(nodeId, { Q_kVAr: 0, V_target: regulator.targetVoltage_V, isLimited: false });
    }
    for (const [nodeId, compensator] of compensators.entries()) {
      compensatorStates.set(nodeId, { Q_phases: { A: 0, B: 0, C: 0 }, IN_A: 0, reductionPercent: 0, isLimited: false });
    }
    
    // Tensions précédentes pour convergence
    let previousVoltages = new Map<string, number>();
    
    while (iteration < maxIterations && !converged) {
      iteration++;
      console.log(`🔄 Simulation iteration ${iteration}`);
      
      // 1. Calculer le réseau avec les équipements actuels
      const modifiedNodes = this.applyEquipmentToNodes(nodes, regulatorStates, compensatorStates);
      let currentResult = this.calculateScenario(
        modifiedNodes, cables, cableTypes, scenario,
        foisonnementCharges, foisonnementProductions,
        transformerConfig, loadModel, desequilibrePourcent
      );
      
      // Sauvegarder les tensions pour convergence
      if (currentResult.nodeMetrics) {
        for (const nodeMetric of currentResult.nodeMetrics) {
          previousVoltages.set(nodeMetric.nodeId, nodeMetric.V_phase_V);
        }
      }
      
      let equipmentChanged = false;
      
      // 2. Traiter les régulateurs de tension (PV nodes) avec recalcul aval après chaque ajustement
      for (const [nodeId, regulator] of regulators.entries()) {
        const targetV = regulator.targetVoltage_V;
        const state = regulatorStates.get(nodeId)!;
        const node = nodeById.get(nodeId);
        if (!node) continue;

        let localIter = 0;
        let localConverged = false;

        while (localIter < 20) {
          localIter++;
          // Tension actuelle du nœud (ligne) à partir du résultat courant
          const currentV_line = this.getNodeLineVoltageFromResult(currentResult, node, nodes);
          const errorV = targetV - currentV_line; // >0 => il faut monter la tension -> Q(+)
          const absError = Math.abs(errorV);
          if (absError < this.convergenceTolerance) { localConverged = true; break; }

          const Kp = 2.0; // correcteur proportionnel simple
          const maxQ = regulator.maxPower_kVA;
          let requiredQ = Math.sign(errorV) * Math.min(absError * Kp, maxQ);

          // Anti-windup et indication de limite
          if (Math.abs(requiredQ) >= maxQ) {
            requiredQ = Math.sign(requiredQ) * maxQ;
            state.isLimited = true;
          } else {
            state.isLimited = false;
          }

          if (Math.abs(requiredQ - state.Q_kVAr) < 0.05) { // peu de changement
            break;
          }

          // Appliquer le nouveau Q et recalculer le réseau (propagation aval via BFS)
          state.Q_kVAr = requiredQ;
          equipmentChanged = true;

          const nodesWithEquip = this.applyEquipmentToNodes(nodes, regulatorStates, compensatorStates);
          currentResult = this.calculateScenario(
            nodesWithEquip, cables, cableTypes, scenario,
            foisonnementCharges, foisonnementProductions,
            transformerConfig, loadModel, desequilibrePourcent
          );
        }

        console.log(`📊 Régulateur ${nodeId}: Q=${state.Q_kVAr.toFixed(2)} kVAr, limited=${state.isLimited}`);
      }
      
      // 3. Traiter les compensateurs de neutre (400V + monophasé PN + déséquilibre uniquement)
      for (const [nodeId, compensator] of compensators.entries()) {
        const currentState = compensatorStates.get(nodeId)!;
        const node = nodeById.get(nodeId);
        const is400V = (transformerConfig?.nominalVoltage_V ?? 400) >= 350;
        const isMonoPN = node?.connectionType === 'MONO_230V_PN';
        const hasDeseq = loadModel === 'monophase_reparti' && desequilibrePourcent > 0;

        if (!(is400V && isMonoPN && hasDeseq)) {
          // Inéligible: remettre l'état à zéro et publier résultats neutres
          const prevIN = currentState.IN_A;
          currentState.IN_A = 0;
          currentState.reductionPercent = 0;
          currentState.Q_phases = { A: 0, B: 0, C: 0 };
          currentState.isLimited = false;
          compensator.currentIN_A = 0;
          compensator.reductionPercent = 0;
          compensator.compensationQ_kVAr = { A: 0, B: 0, C: 0 };
          // Ne pas signaler de changement si déjà à zéro
          const changed = Math.abs(prevIN) > 0.01;
          if (changed) equipmentChanged = true;
          continue;
        }

        const changed = this.processNeutralCompensator(
          nodeId, compensator, currentResult, currentState, loadModel, desequilibrePourcent
        );
        
        if (changed) {
          equipmentChanged = true;
          console.log(`⚡ Compensateur ${nodeId}: IN=${currentState.IN_A.toFixed(2)} A, limited=${currentState.isLimited}`);
        }
      }
      
      // 4. Si équipements changés, recalculer le réseau complet
      if (equipmentChanged) {
        const finalModifiedNodes = this.applyEquipmentToNodes(nodes, regulatorStates, compensatorStates);
        currentResult = this.calculateScenario(
          finalModifiedNodes, cables, cableTypes, scenario,
          foisonnementCharges, foisonnementProductions,
          transformerConfig, loadModel, desequilibrePourcent
        );
      }
      
      // 5. Test de convergence
      maxVoltageDelta = 0;
      if (currentResult.nodeMetrics) {
        for (const nodeMetric of currentResult.nodeMetrics) {
          const prevV = previousVoltages.get(nodeMetric.nodeId) || nodeMetric.V_phase_V;
          const deltaV = Math.abs(nodeMetric.V_phase_V - prevV);
          if (deltaV > maxVoltageDelta) {
            maxVoltageDelta = deltaV;
          }
        }
      }
      
      if (maxVoltageDelta < this.convergenceTolerance) {
        converged = true;
      }
    }
    
    // 6. Mise à jour des résultats dans les équipements originaux
    this.updateEquipmentResults(regulators, regulatorStates, compensators, compensatorStates);
    
    if (!converged) {
      console.warn(`⚠️ Simulation BFS non convergé après ${maxIterations} itérations (δV max = ${maxVoltageDelta.toFixed(3)}V)`);
    } else {
      console.log(`✅ Simulation BFS convergé en ${iteration} itérations`);
    }

    // Calcul final avec les équipements convergés
    const finalNodes = this.applyEquipmentToNodes(nodes, regulatorStates, compensatorStates);
    return this.calculateScenario(
      finalNodes, cables, cableTypes, scenario,
      foisonnementCharges, foisonnementProductions,
      transformerConfig, loadModel, desequilibrePourcent
    );
  }

  /**
   * Construit la map d'adjacence du réseau
   */
  private buildAdjacencyMap(nodes: Node[], cables: Cable[]): Map<string, string[]> {
    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n.id, []);
    
    for (const cable of cables) {
      adj.get(cable.nodeAId)?.push(cable.nodeBId);
      adj.get(cable.nodeBId)?.push(cable.nodeAId);
    }
    
    return adj;
  }

  /**
   * Construit la structure arborescente du réseau
   */
  private buildTreeStructure(nodes: Node[], cables: Cable[], adjacency: Map<string, string[]>) {
    const source = nodes.find(n => n.isSource);
    if (!source) throw new Error('Aucune source trouvée');
    
    const parent = new Map<string, string | null>();
    const children = new Map<string, string[]>();
    const visited = new Set<string>();
    
    // BFS pour construire l'arbre
    const queue = [source.id];
    parent.set(source.id, null);
    visited.add(source.id);
    
    for (const n of nodes) children.set(n.id, []);
    
    while (queue.length) {
      const nodeId = queue.shift()!;
      const neighbors = adjacency.get(nodeId) || [];
      
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          parent.set(neighborId, nodeId);
          children.get(nodeId)!.push(neighborId);
          queue.push(neighborId);
        }
      }
    }
    
    return { parent, children, source: source.id };
  }

  /**
   * Traite un régulateur de tension (logique PV node)
   */
  private processVoltageRegulator(
    nodeId: string,
    regulator: VoltageRegulator,
    nodeMetric: any,
    currentState: { Q_kVAr: number, V_target: number, isLimited: boolean },
    nodeById: Map<string, Node>,
    treeStructure: any
  ): boolean {
    const node = nodeById.get(nodeId);
    if (!node) return false;
    
    // Conversion tension phase -> ligne si nécessaire
    const currentV_phase = nodeMetric.V_phase_V;
    const isThreePhase = this.getNodeVoltageConfig(node.connectionType).isThreePhase;
    const currentV_line = currentV_phase * (isThreePhase ? Math.sqrt(3) : 1);
    
    const targetV = regulator.targetVoltage_V;
    const errorV = targetV - currentV_line;
    const absErrorV = Math.abs(errorV);
    
    if (absErrorV < this.convergenceTolerance) {
      // Tension OK, pas de changement
      currentState.isLimited = false;
      return false;
    }
    
    // Calcul du Q nécessaire (contrôleur PI simplifié)
    const Kp = 2.0; // Gain proportionnel
    const maxQ = regulator.maxPower_kVA;
    
    let requiredQ = Math.sign(errorV) * Math.min(absErrorV * Kp, maxQ);
    
    // Anti-windup : limitation à Smax
    if (Math.abs(requiredQ) >= maxQ) {
      requiredQ = Math.sign(requiredQ) * maxQ;
      currentState.isLimited = true;
    } else {
      currentState.isLimited = false;
    }
    
    // Vérifier si changement significatif
    const deltaQ = Math.abs(requiredQ - currentState.Q_kVAr);
    if (deltaQ > 0.1) { // Seuil de 0.1 kVAr
      currentState.Q_kVAr = requiredQ;
      return true;
    }
    
    return false;
  }

  /**
   * Traite un compensateur de neutre
   */
  private processNeutralCompensator(
    nodeId: string,
    compensator: NeutralCompensator,
    result: CalculationResult,
    currentState: { Q_phases: { A: number, B: number, C: number }, IN_A: number, reductionPercent: number, isLimited: boolean },
    _loadModel: LoadModel,
    _desequilibrePourcent: number
  ): boolean {
    // Paramètres d'entrée EQUI8 (modèle linéarisé CME)
    const Zp = compensator.zPhase_Ohm ?? 0.5;      // Ω (phase)
    const Zn = compensator.zNeutral_Ohm ?? 0.2;    // Ω (neutre)

    // Récupération des tensions phase-neutre initiales (U1,U2,U3)
    let U1 = 230, U2 = 230, U3 = 230;
    const perPhase = result.nodePhasorsPerPhase?.filter(p => p.nodeId === nodeId);
    const metric = result.nodeMetrics?.find(m => m.nodeId === nodeId);
    if (perPhase && perPhase.length >= 3) {
      const magA = perPhase.find(p => p.phase === 'A')?.V_phase_V;
      const magB = perPhase.find(p => p.phase === 'B')?.V_phase_V;
      const magC = perPhase.find(p => p.phase === 'C')?.V_phase_V;
      if (magA && magB && magC) {
        U1 = magA; U2 = magB; U3 = magC;
      }
    } else if (metric) {
      U1 = U2 = U3 = metric.V_phase_V;
    }

    // Moyennes/écarts initiaux
    const Umoy_init = (U1 + U2 + U3) / 3;
    const Umax_init = Math.max(U1, U2, U3);
    const Umin_init = Math.min(U1, U2, U3);
    const delta_init = Umax_init - Umin_init; // (Umax-Umin)init

    // Ratios par phase (garder 0 si delta_init ~ 0)
    const denom = Math.abs(delta_init) > 1e-9 ? delta_init : 1; // éviter division par zéro
    const R1 = Math.abs(delta_init) > 1e-9 ? (U1 - Umoy_init) / denom : 0;
    const R2 = Math.abs(delta_init) > 1e-9 ? (U2 - Umoy_init) / denom : 0;
    const R3 = Math.abs(delta_init) > 1e-9 ? (U3 - Umoy_init) / denom : 0;

    // Validité du modèle (conditions: Zph et Zn > 0,15 Ω)
    const validZ = (Zp > 0.15) && (Zn > 0.15) && (Zp > 0);

    // Facteur réseau k_imp et réduction d'écart de tension d'après CME
    const k_imp = (2 * Zp) / (Zp + Zn);
    const factorDen = validZ ? (0.9119 * Math.log(Zp) + 3.8654) : 1; // fallback 1 si invalide
    const delta_equ = validZ ? (1 / factorDen) * delta_init * k_imp : delta_init;

    // Tensions corrigées par EQUI8 (Umoy init conservée)
    const U1p = Umoy_init + R1 * delta_equ;
    const U2p = Umoy_init + R2 * delta_equ;
    const U3p = Umoy_init + R3 * delta_equ;

    // Calcul du courant neutre initial via phasors (angles 0/-120/+120)
    const deg2rad = (d: number) => (Math.PI * d) / 180;
    const E1 = fromPolar(U1, deg2rad(0));
    const E2 = fromPolar(U2, deg2rad(-120));
    const E3 = fromPolar(U3, deg2rad(120));
    const Z_phase = C(Zp, 0);
    const Ia0 = div(E1, Z_phase);
    const Ib0 = div(E2, Z_phase);
    const Ic0 = div(E3, Z_phase);
    const In0 = add(add(Ia0, Ib0), Ic0);
    const IN_initial = abs(In0);

    // Courant dans le neutre de l'EQUI8 (A) - modèle CME
    const I_EQUI8 = validZ ? 0.392 * Math.pow(Zp, -0.8065) * delta_init * k_imp : 0;

    // Estimation du courant neutre résiduel après compensation
    const IN_after = Math.max(IN_initial - I_EQUI8, 0);
    const absorbed = I_EQUI8;
    const reductionPercent = IN_initial > 1e-9 ? (absorbed / IN_initial) * 100 : 0;

    const changed = Math.abs(currentState.IN_A - IN_after) > 0.01 || Math.abs(currentState.reductionPercent - reductionPercent) > 0.1
      || Math.abs((compensator.u1p_V ?? 0) - U1p) > 0.5 || Math.abs((compensator.u2p_V ?? 0) - U2p) > 0.5 || Math.abs((compensator.u3p_V ?? 0) - U3p) > 0.5;

    // Mettre à jour l'état et les sorties UI
    currentState.IN_A = IN_after;
    currentState.reductionPercent = reductionPercent;
    currentState.Q_phases = { A: 0, B: 0, C: 0 }; // Modèle passif
    currentState.isLimited = false;

    compensator.iN_initial_A = IN_initial;
    compensator.iN_absorbed_A = absorbed;
    compensator.u1p_V = U1p;
    compensator.u2p_V = U2p;
    compensator.u3p_V = U3p;

    return changed;
  }

  /**
   * Applique les états des équipements aux nœuds pour le calcul
   */
  private applyEquipmentToNodes(
    originalNodes: Node[],
    regulatorStates: Map<string, { Q_kVAr: number, V_target: number, isLimited: boolean }>,
    compensatorStates: Map<string, { Q_phases: { A: number, B: number, C: number }, IN_A: number, reductionPercent: number, isLimited: boolean }>
  ): Node[] {
    return originalNodes.map(node => {
      let modifiedNode = { ...node };
      
      // Appliquer régulateur (Q positif = injection, Q négatif = absorption)
      const regulatorState = regulatorStates.get(node.id);
      if (regulatorState) {
        const Q = regulatorState.Q_kVAr || 0;
        // Nettoyer les anciennes entrées virtuelles
        modifiedNode.productions = (modifiedNode.productions || []).filter(p => !p.id.startsWith('regulator-'));
        modifiedNode.clients = (modifiedNode.clients || []).filter(c => !c.id.startsWith('regulator-'));

        if (Math.abs(Q) > 0.01) {
          const sinPhi = Math.sqrt(Math.max(0, 1 - this.simCosPhi * this.simCosPhi)) || 1e-6;
          const neededS_kVA = Math.abs(Q) / Math.max(sinPhi, 1e-6);
          if (Q > 0) {
            // Injection de Q (+) -> production équivalente
            const virt = { id: `regulator-${node.id}`, label: 'Régulateur (Q+)', S_kVA: neededS_kVA };
            modifiedNode.productions = [...(modifiedNode.productions || []), virt];
          } else {
            // Absorption de Q (-) -> charge équivalente
            const virt = { id: `regulator-${node.id}`, label: 'Régulateur (Q−)', S_kVA: neededS_kVA } as any;
            modifiedNode.clients = [...(modifiedNode.clients || []), virt];
          }
        }
      }
      
      // Appliquer compensateur (pour l'instant, approximation via production équivalente)
      const compensatorState = compensatorStates.get(node.id);
      if (compensatorState) {
        const totalQ = compensatorState.Q_phases.A + compensatorState.Q_phases.B + compensatorState.Q_phases.C;
        if (totalQ > 0.01) {
          const compensatorProd = {
            id: `compensator-${node.id}`,
            label: 'Compensateur',
            S_kVA: totalQ
          };
          
          const existingIdx = modifiedNode.productions.findIndex(p => p.id.startsWith('compensator-'));
          if (existingIdx >= 0) {
            modifiedNode.productions[existingIdx] = compensatorProd;
          } else {
            modifiedNode.productions = [...modifiedNode.productions, compensatorProd];
          }
        }
      }
      
      return modifiedNode;
    });
  }

  /**
   * Met à jour les résultats dans les équipements originaux
   */
  private updateEquipmentResults(
    regulators: Map<string, VoltageRegulator>,
    regulatorStates: Map<string, { Q_kVAr: number, V_target: number, isLimited: boolean }>,
    compensators: Map<string, NeutralCompensator>,
    compensatorStates: Map<string, { Q_phases: { A: number, B: number, C: number }, IN_A: number, reductionPercent: number, isLimited: boolean }>
  ): void {
    // Mise à jour des régulateurs
    for (const [nodeId, regulator] of regulators.entries()) {
      const state = regulatorStates.get(nodeId);
      if (state) {
        regulator.currentQ_kVAr = state.Q_kVAr;
        regulator.currentVoltage_V = state.V_target; // Sera mis à jour par le calcul final
        regulator.isLimited = state.isLimited;
      }
    }
    
    // Mise à jour des compensateurs
    for (const [nodeId, compensator] of compensators.entries()) {
      const state = compensatorStates.get(nodeId);
      if (state) {
        compensator.currentIN_A = state.IN_A;
        compensator.reductionPercent = state.reductionPercent;
        compensator.compensationQ_kVAr = state.Q_phases;
        compensator.isLimited = state.isLimited;
      }
    }
  }

  /**
   * Fonction utilitaire pour obtenir les informations de tension d'un type de connexion
   */
  private getNodeVoltageConfig(connectionType: ConnectionType): { U_base: number; isThreePhase: boolean } {
    switch (connectionType) {
      case 'MONO_230V_PN':
        return { U_base: 230, isThreePhase: false };
      case 'MONO_230V_PP':
        return { U_base: 230, isThreePhase: false };
      case 'TRI_230V_3F':
        return { U_base: 230, isThreePhase: true };
      case 'TÉTRA_3P+N_230_400V':
        return { U_base: 400, isThreePhase: true };
      default:
        return { U_base: 230, isThreePhase: true };
    }
  }

  // Récupère la tension ligne du nœud à partir du résultat (gère équilibré/déséquilibré)
  private getNodeLineVoltageFromResult(result: CalculationResult, node: Node, _allNodes: Node[]): number {
    const { isThreePhase, U_base } = this.getNodeVoltageConfig(node.connectionType);

    // Mode équilibré: nodeMetrics présent avec V_phase_V
    const metric = result.nodeMetrics?.find(m => m.nodeId === node.id);
    if (metric) {
      const V_phase = metric.V_phase_V;
      return isThreePhase ? V_phase * Math.sqrt(3) : V_phase;
    }

    // Mode déséquilibré: utiliser nodePhasorsPerPhase et prendre la pire phase
    const phases = result.nodePhasorsPerPhase?.filter(p => p.nodeId === node.id) || [];
    if (phases.length > 0) {
      const minPhaseMag = Math.min(...phases.map(p => p.V_phase_V));
      return isThreePhase ? minPhaseMag * Math.sqrt(3) : minPhaseMag;
    }

    // Fallback: tension nominale
    return U_base;
  }
  
  /**
    * Propose automatiquement des améliorations de câbles basées sur l'ampacité réelle
   */
  proposeCableUpgrades(
    project: Project,
    result: CalculationResult,
    voltageDropThreshold: number = 8, // %
    overloadThreshold: number = 1.0, // facteur de sécurité
    estimatedCostPerUpgrade: number = 1500 // Coût paramétrable par défaut
  ): CableUpgrade[] {
    const upgrades: CableUpgrade[] = [];
    const cableTypeById = new Map(project.cableTypes.map(ct => [ct.id, ct]));
    
    // Trier les types de câbles par section (approximation via résistance décroissante)
    const sortedCableTypes = [...project.cableTypes].sort((a, b) => 
      a.R12_ohm_per_km - b.R12_ohm_per_km
    );

    for (const cable of result.cables) {
      if (!cable.voltageDropPercent && !cable.current_A) continue;

      const currentType = cableTypeById.get(cable.typeId);
      if (!currentType) continue;

      // Utiliser maxCurrent_A si disponible, sinon fallback estimation basée sur section
      const maxCurrentA = currentType.maxCurrent_A || this.estimateMaxCurrent(currentType);
      
      // Vérifier les conditions d'upgrade
      const hasVoltageDropIssue = cable.voltageDropPercent && Math.abs(cable.voltageDropPercent) > voltageDropThreshold;
      const hasOverloadIssue = cable.current_A && cable.current_A > maxCurrentA * overloadThreshold;
      
      if (!hasVoltageDropIssue && !hasOverloadIssue) continue;

      // Trouver un type de section supérieure
      const currentTypeIndex = sortedCableTypes.findIndex(ct => ct.id === cable.typeId);
      if (currentTypeIndex === -1) continue;

      // Chercher le prochain câble avec ampacité suffisante
      let nextType: CableType | null = null;
      for (let i = currentTypeIndex + 1; i < sortedCableTypes.length; i++) {
        const candidate = sortedCableTypes[i];
        const candidateMaxCurrent = candidate.maxCurrent_A || this.estimateMaxCurrent(candidate);
        
        // Vérifier si ce câble résout le problème d'ampacité
        if (!hasOverloadIssue || (cable.current_A && cable.current_A <= candidateMaxCurrent * overloadThreshold)) {
          nextType = candidate;
          break;
        }
      }
      
      if (!nextType) continue;

      // Estimation des améliorations
      const improvementFactor = currentType.R12_ohm_per_km / nextType.R12_ohm_per_km;
      const newVoltageDropPercent = (cable.voltageDropPercent || 0) / improvementFactor;
      const newLosses_kW = (cable.losses_kW || 0) / (improvementFactor * improvementFactor);

      // Déterminer la raison de l'upgrade
      let reason: CableUpgrade['reason'];
      if (hasVoltageDropIssue && hasOverloadIssue) {
        reason = 'both';
      } else if (hasVoltageDropIssue) {
        reason = 'voltage_drop';
      } else {
        reason = 'overload';
      }

      upgrades.push({
        originalCableId: cable.id,
        newCableTypeId: nextType.id,
        reason,
        before: {
          voltageDropPercent: cable.voltageDropPercent || 0,
          current_A: cable.current_A || 0,
          losses_kW: cable.losses_kW || 0
        },
        after: {
          voltageDropPercent: newVoltageDropPercent,
          current_A: cable.current_A || 0, // Le courant ne change pas
          losses_kW: newLosses_kW,
          estimatedCost: estimatedCostPerUpgrade
        },
        improvement: {
          voltageDropReduction: Math.abs((cable.voltageDropPercent || 0) - newVoltageDropPercent),
          lossReduction_kW: (cable.losses_kW || 0) - newLosses_kW,
          lossReductionPercent: ((cable.losses_kW || 0) - newLosses_kW) / Math.max(cable.losses_kW || 1, 0.001) * 100
        }
      });
    }

    return upgrades;
  }

  /**
   * Estime l'ampacité d'un câble si maxCurrent_A n'est pas fourni
   */
  private estimateMaxCurrent(cableType: CableType): number {
    // Estimation basique basée sur la résistance (plus la résistance est faible, plus l'ampacité est élevée)
    const baseResistance = 1.83; // Résistance cuivre 10 mm² de référence
    const baseAmpacity = 60; // Ampacité cuivre 10 mm² de référence
    
    // Facteur matériau (aluminium ~85% du cuivre)
    const materialFactor = cableType.matiere === 'ALUMINIUM' ? 0.85 : 1.0;
    
    // Estimation par rapport inversement proportionnelle à la résistance
    const estimatedAmpacity = (baseResistance / cableType.R12_ohm_per_km) * baseAmpacity * materialFactor;
    
    return Math.round(estimatedAmpacity);
  }

  /**
   * Crée une armoire de régulation par défaut pour un nœud
   */
  createDefaultRegulator(nodeId: string, voltageSystem: '230V' | '400V'): VoltageRegulator {
    const type: RegulatorType = voltageSystem === '230V' ? '230V_77kVA' : '400V_44kVA';
    const maxPower = voltageSystem === '230V' ? 77 : 44;
    const targetVoltage = voltageSystem === '230V' ? 230 : 400;

    return {
      id: `regulator-${nodeId}-${Date.now()}`,
      nodeId,
      type,
      targetVoltage_V: targetVoltage,
      maxPower_kVA: maxPower,
      enabled: true
    };
  }

  /**
   * Crée un compensateur de neutre par défaut pour un nœud
   */
  createDefaultNeutralCompensator(nodeId: string): NeutralCompensator {
    return {
      id: `compensator-${nodeId}-${Date.now()}`,
      nodeId,
      maxPower_kVA: 30, // Puissance par défaut
      tolerance_A: 5, // Seuil par défaut
      enabled: true
    };
  }
}