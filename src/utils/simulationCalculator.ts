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
    
    const maxIterations = SimulationCalculator.SIM_MAX_ITERATIONS;
    let converged = false;
    let iteration = 0;
    let maxVoltageDelta = 0;
    
    // Structures pour le graphe et les calculs
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const adjacency = this.buildAdjacencyMap(nodes, cables);
    const treeStructure = this.buildTreeStructure(nodes, cables, adjacency);
    
    // État des équipements à chaque itération
    const regulatorStates = new Map<string, { Q_kVAr: number, V_target: number, isLimited: boolean }>();
    const compensatorStates = new Map<string, { S_virtual_kVA: number, IN_A: number, reductionPercent: number, isLimited: boolean }>();
    
    // Initialisation des états
    for (const [nodeId, regulator] of regulators.entries()) {
      regulatorStates.set(nodeId, { Q_kVAr: 0, V_target: regulator.targetVoltage_V, isLimited: false });
    }
    for (const [nodeId, _compensator] of compensators.entries()) {
      compensatorStates.set(nodeId, { S_virtual_kVA: 0, IN_A: 0, reductionPercent: 0, isLimited: false });
    }
    
    // Tensions précédentes pour convergence
    let previousVoltages = new Map<string, number>();
    // Résultat courant de l'itération
    let currentResult: CalculationResult;
    
    while (iteration < maxIterations && !converged) {
      iteration++;
      console.log(`🔄 Simulation iteration ${iteration}`);
      
      // 1. Calculer le réseau avec les équipements actuels
      const modifiedNodes = this.applyEquipmentToNodes(nodes, regulatorStates, compensatorStates);
      currentResult = this.calculateScenario(
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
      
      // 2. Traiter les régulateurs avec sensibilité dV/dQ dynamique via ΔQ test
      let maxQDelta = 0;
      for (const [nodeId, regulator] of regulators.entries()) {
        const node = nodeById.get(nodeId);
        if (!node) continue;

        const baseV_line = this.getNodeLineVoltageFromResult(currentResult, node, nodes);
        const targetV = regulator.targetVoltage_V;
        const state = regulatorStates.get(nodeId)!;

        // Construire un état test avec ΔQ = +1 kVAr
        const deltaQtest = 1; // kVAr
        const testRegulatorStates = new Map(regulatorStates);
        const testState = { ...state, Q_kVAr: state.Q_kVAr + deltaQtest };
        testRegulatorStates.set(nodeId, testState);

        const testNodes = this.applyEquipmentToNodes(nodes, testRegulatorStates, compensatorStates);
        const testResult = this.calculateScenario(
          testNodes, cables, cableTypes, scenario,
          foisonnementCharges, foisonnementProductions,
          transformerConfig, loadModel, desequilibrePourcent
        );
        const testV_line = this.getNodeLineVoltageFromResult(testResult, node, nodes);

        // Sensibilité numérique
        let sensitivity = (testV_line - baseV_line) / deltaQtest; // V/kVAr
        if (!isFinite(sensitivity) || Math.abs(sensitivity) < 1e-6) {
          // Fallback minimal pour éviter division par zéro
          sensitivity = 0.05; // V/kVAr
        }

        // Correction de Q (damping pour stabilité)
        const deltaV = targetV - baseV_line;
        let deltaQ = deltaV / sensitivity; // kVAr nécessaires
        // Limiter la variation par itération pour éviter la surcompensation
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

        console.log(`📊 Régulateur ${nodeId}: Vbase=${baseV_line.toFixed(1)}V → Q=${state.Q_kVAr.toFixed(2)} kVAr (ΔQ=${deltaQ.toFixed(2)}), limited=${state.isLimited}`);
      }
      
      // 3. Traiter les compensateurs avec modèle physique (shunt homopolaire)
      for (const [nodeId, compensator] of compensators.entries()) {
        const currentState = compensatorStates.get(nodeId)!;
        const node = nodeById.get(nodeId);
        const is400V = (transformerConfig?.nominalVoltage_V ?? 400) >= 350;
        const isMonoPN = node?.connectionType === 'MONO_230V_PN';
        const hasDeseq = loadModel === 'monophase_reparti' && desequilibrePourcent > 0;

        if (!(is400V && isMonoPN && hasDeseq)) {
          // Inéligible: remettre l'état à zéro
          const prevIN = currentState.IN_A;
          currentState.IN_A = 0;
          currentState.reductionPercent = 0;
          currentState.S_virtual_kVA = 0;
          currentState.isLimited = false;
          compensator.currentIN_A = 0;
          compensator.reductionPercent = 0;
          compensator.compensationQ_kVAr = { A: 0, B: 0, C: 0 };
          const changed = Math.abs(prevIN) > 0.01;
          if (changed) equipmentChanged = true;
          continue;
        }

        const changed = this.processNeutralCompensator(
          nodeId, compensator, currentResult, currentState, loadModel, desequilibrePourcent
        );
        
        if (changed) {
          equipmentChanged = true;
          console.log(`⚡ Compensateur ${nodeId}: IN=${currentState.IN_A.toFixed(2)} A, Svirt=${currentState.S_virtual_kVA.toFixed(2)} kVA, limited=${currentState.isLimited}`);
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
      
      // 5. Test de convergence (tension + stabilité Q)
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
      
      if (
        maxVoltageDelta < SimulationCalculator.SIM_CONVERGENCE_TOLERANCE_PHASE_V &&
        (typeof maxQDelta === 'number' ? maxQDelta : 0) < 0.1
      ) {
        converged = true;
      }
    }
    
    // 6. Calcul final avec états d'équipement figés pour garantir la cohérence
    {
      const finalModifiedNodes = this.applyEquipmentToNodes(nodes, regulatorStates, compensatorStates);
      currentResult = this.calculateScenario(
        finalModifiedNodes, cables, cableTypes, scenario,
        foisonnementCharges, foisonnementProductions,
        transformerConfig, loadModel, desequilibrePourcent
      );
    }

    // 7. Mise à jour des résultats dans les équipements originaux
    this.updateEquipmentResults(regulators, regulatorStates, compensators, compensatorStates);
    
    if (!converged) {
      console.warn(`⚠️ Simulation BFS non convergé après ${maxIterations} itérations (δV max = ${maxVoltageDelta.toFixed(3)}V)`);
    } else {
      console.log(`✅ Simulation BFS convergé en ${iteration} itérations`);
    }

    // Mettre à jour la tension mesurée aux nœuds des régulateurs (affichage) avec le dernier résultat
    for (const [nodeId, regulator] of regulators.entries()) {
      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        regulator.currentVoltage_V = this.getNodeLineVoltageFromResult(currentResult, node, nodes);
      }
    }

    // Renvoyer directement le résultat de la dernière itération
    return currentResult;
  }


  /**
   * Modèle physique du compensateur de neutre basé sur les composantes symétriques
   */
  private calculateNeutralCompensation(I_phases: Complex[]): Complex {
    // Calcul de la séquence homopolaire (courant de neutre théorique)
    const I0 = add(add(I_phases[0], I_phases[1]), I_phases[2]);
    const I0_mag = abs(I0) / 3; // Courant homopolaire normalisé
    
    // Impédance de compensation (R + jX du compensateur)
    const R_compensation = 0.1; // Ω (résistance série)
    const X_compensation = 0.05; // Ω (réactance série)  
    const Z_compensation = C(R_compensation, X_compensation);
    
    // Tension de compensation = Z × I0
    return mul(I0, Z_compensation);
  }

  /**
   * Calcule les courants de phase à partir des tensions et impédances
   */
  private calculatePhaseCurrents(U1: number, U2: number, U3: number, Zp: number): Complex[] {
    const deg2rad = (d: number) => (Math.PI * d) / 180;
    
    // Tensions phasorelles (angles 120° décalés)
    const E1 = fromPolar(U1, deg2rad(0));
    const E2 = fromPolar(U2, deg2rad(-120));
    const E3 = fromPolar(U3, deg2rad(120));
    
    // Impédance de phase (supposée résistive pour simplifier)
    const Z_phase = C(Zp, 0);
    
    // Courants de phase I = U/Z
    const I1 = div(E1, Z_phase);
    const I2 = div(E2, Z_phase);
    const I3 = div(E3, Z_phase);
    
    return [I1, I2, I3];
  }
  private processNeutralCompensator(
    nodeId: string,
    compensator: NeutralCompensator,
    result: CalculationResult,
    currentState: { S_virtual_kVA: number, IN_A: number, reductionPercent: number, isLimited: boolean },
    _loadModel: LoadModel,
    _desequilibrePourcent: number
  ): boolean {
    // Impédances fournies (préférence aux nouveaux champs, fallback anciens). Valeurs très faibles si absentes
    const Zp = Math.max(1e-6, compensator.phaseImpedance ?? compensator.zPhase_Ohm ?? 1e-6); // Ω (phase)
    const Zn = Math.max(1e-6, compensator.neutralImpedance ?? compensator.zNeutral_Ohm ?? 1e-6); // Ω (neutre)

    // Tensions phase-neutre (U1,U2,U3) au nœud
    let U1 = 230, U2 = 230, U3 = 230;
    const perPhase = result.nodePhasorsPerPhase?.filter(p => p.nodeId === nodeId);
    const metric = result.nodeMetrics?.find(m => m.nodeId === nodeId);
    if (perPhase && perPhase.length >= 3) {
      const magA = perPhase.find(p => p.phase === 'A')?.V_phase_V;
      const magB = perPhase.find(p => p.phase === 'B')?.V_phase_V;
      const magC = perPhase.find(p => p.phase === 'C')?.V_phase_V;
      if (magA && magB && magC) { U1 = magA; U2 = magB; U3 = magC; }
    } else if (metric) {
      U1 = U2 = U3 = metric.V_phase_V;
    }

    // Courants de phase approximés pour obtenir I_N initial
    const I_phases = this.calculatePhaseCurrents(U1, U2, U3, Zp);
    const In0 = add(add(I_phases[0], I_phases[1]), I_phases[2]);
    const IN_initial = abs(In0);

    // Facteur de compensation: k = |Zn| / (|Zn| + |Zp|)
    const k = Math.max(0, Math.min(1, Zn / (Zn + Zp)));

    // Courant de neutre absorbé par le compensateur
    let I_absorbed = k * IN_initial; // A

    // Puissance apparente équivalente consommée par le compensateur (PF≈1)
    const V_phase_ref = (U1 + U2 + U3) / 3 || 230; // V moyenne de phase
    let S_virtual_kVA = (V_phase_ref * I_absorbed) / 1000; // kVA
    S_virtual_kVA = Math.max(0, S_virtual_kVA);

    // Limitation par la puissance max du compensateur
    const Smax = Math.max(0, compensator.maxPower_kVA || 0);
    let limited = false;
    if (Smax > 0 && S_virtual_kVA > Smax) {
      S_virtual_kVA = Smax;
      // Ajuster I_absorbed en conséquence
      I_absorbed = (S_virtual_kVA * 1000) / Math.max(V_phase_ref, 1e-6);
      limited = true;
    }

    const IN_after = Math.max(IN_initial - I_absorbed, 0);
    const reductionPercent = IN_initial > 1e-9 ? ((IN_initial - IN_after) / IN_initial) * 100 : 0;

    const changed = Math.abs(currentState.IN_A - IN_after) > 0.01 ||
                    Math.abs(currentState.reductionPercent - reductionPercent) > 0.1 ||
                    Math.abs((currentState.S_virtual_kVA || 0) - S_virtual_kVA) > 0.01;

    // Mettre à jour l'état
    currentState.IN_A = IN_after;
    currentState.reductionPercent = reductionPercent;
    currentState.S_virtual_kVA = S_virtual_kVA;
    currentState.isLimited = limited;

    // Sorties d'aide au debug
    compensator.iN_initial_A = IN_initial;
    compensator.iN_absorbed_A = I_absorbed;
    compensator.compensationQ_kVAr = { A: 0, B: 0, C: 0 };

    return changed;
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
   * Applique les états des équipements aux nœuds pour le calcul
   */
  private applyEquipmentToNodes(
    originalNodes: Node[],
    regulatorStates: Map<string, { Q_kVAr: number, V_target: number, isLimited: boolean }>,
    compensatorStates: Map<string, { S_virtual_kVA: number, IN_A: number, reductionPercent: number, isLimited: boolean }>
  ): Node[] {
    return originalNodes.map(node => {
      let modifiedNode = { ...node };
      
      // Appliquer régulateur avec modèle réactif pur correct
      const regulatorState = regulatorStates.get(node.id);
      if (regulatorState) {
        const Q = regulatorState.Q_kVAr || 0;
        // Nettoyer les anciennes entrées virtuelles
        modifiedNode.productions = (modifiedNode.productions || []).filter(p => !p.id.startsWith('regulator-'));
        modifiedNode.clients = (modifiedNode.clients || []).filter(c => !c.id.startsWith('regulator-'));

        if (Math.abs(Q) > 0.01) {
          if (Q > 0) {
            // Injection de réactif (+) -> production avec P=0, Q>0
            const virt: any = { 
              id: `regulator-${node.id}`, 
              label: 'Régulateur (Q+)', 
              P_kW: 0,
              Q_kVAr: Q
            };
            modifiedNode.productions = [...(modifiedNode.productions || []), virt];
          } else {
            // Absorption de réactif (-) -> charge avec P=0, Q>0 (consommation)
            const virt: any = { 
              id: `regulator-${node.id}`, 
              label: 'Régulateur (Q−)', 
              P_kW: 0,
              Q_kVAr: Math.abs(Q)
            };
            modifiedNode.clients = [...(modifiedNode.clients || []), virt];
          }
        }
      }
      
      // Appliquer compensateur (charge virtuelle S)
      const compensatorState = compensatorStates.get(node.id);
      if (compensatorState) {
        // Nettoyer les anciennes entrées virtuelles du compensateur
        modifiedNode.productions = (modifiedNode.productions || []).filter(p => !p.id.startsWith('compensator-'));
        modifiedNode.clients = (modifiedNode.clients || []).filter(c => !c.id.startsWith('compensator-'));

        const Svirt = compensatorState.S_virtual_kVA || 0;
        if (Svirt > 0.001) {
          // Modéliser comme une charge triphasée équilibrée purement résistive (PF≈1)
          const virtLoad: any = {
            id: `compensator-${node.id}`,
            label: 'Compensateur (Svirt)',
            P_kW: Svirt,
            Q_kVAr: 0
          };
          modifiedNode.clients = [...(modifiedNode.clients || []), virtLoad];
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
    compensatorStates: Map<string, { S_virtual_kVA: number, IN_A: number, reductionPercent: number, isLimited: boolean }>
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
        // Q par phase non utilisé dans le nouveau modèle → 0
        compensator.compensationQ_kVAr = { A: 0, B: 0, C: 0 };
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
    const { U_base } = this.getNodeVoltageConfig(node.connectionType);

    // Déterminer l'échelle ligne/phase correctement selon le type de connexion
    const lineScale = (() => {
      switch (node.connectionType) {
        case 'TRI_230V_3F':
          // En 3F/230V, V_phase_V est déjà la tension composée (230V)
          return 1;
        case 'TÉTRA_3P+N_230_400V':
          // En 3P+N/400V, conversion phase → ligne
          return Math.sqrt(3);
        case 'MONO_230V_PN':
        case 'MONO_230V_PP':
        default:
          return 1;
      }
    })();

    // Mode équilibré: nodeMetrics présent avec V_phase_V
    const metric = result.nodeMetrics?.find(m => m.nodeId === node.id);
    if (metric) {
      const V_phase = metric.V_phase_V;
      return V_phase * lineScale;
    }

    // Mode déséquilibré: utiliser nodePhasorsPerPhase et prendre la pire phase
    const phases = result.nodePhasorsPerPhase?.filter(p => p.nodeId === node.id) || [];
    if (phases.length > 0) {
      const minPhaseMag = Math.min(...phases.map(p => p.V_phase_V));
      return minPhaseMag * lineScale;
    }

    // Fallback: tension nominale
    return U_base;
  }
  
  /**
   * Propose automatiquement des améliorations de câbles avec ampacité physique
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

      // Utiliser maxCurrent_A si disponible, sinon table de correspondance physique
      const maxCurrentA = currentType.maxCurrent_A || this.getAmpacityFromSection(
        this.extractSectionFromCableType(currentType), 
        currentType.matiere
      );
      
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
        const candidateMaxCurrent = candidate.maxCurrent_A || this.getAmpacityFromSection(
          this.extractSectionFromCableType(candidate), 
          candidate.matiere
        );
        
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
   * Obtient l'ampacité d'un câble basée sur une table de correspondance physique
   */
  private getAmpacityFromSection(section_mm2: number, material: 'CUIVRE'|'ALUMINIUM'): number {
    const ampacityTable = {
      'CUIVRE': { 
        1.5: 20, 2.5: 30, 4: 40, 6: 50, 10: 60, 16: 80, 25: 110, 35: 140, 50: 180, 70: 230, 95: 280, 120: 320 
      },
      'ALUMINIUM': { 
        16: 65, 25: 90, 35: 115, 50: 150, 70: 190, 95: 230, 120: 270, 150: 320, 185: 370, 240: 430 
      }
    };
    
    // Rechercher la section exacte dans la table
    const table = ampacityTable[material];
    if (table && table[section_mm2]) {
      return table[section_mm2];
    }
    
    // Si section non trouvée, estimation basée sur la résistance
    return this.estimateFromResistance(section_mm2, material);
  }

  /**
   * Estimation d'ampacité basée sur la résistance (fallback)
   */
  private estimateFromResistance(section_mm2: number, material: 'CUIVRE'|'ALUMINIUM'): number {
    // Résistivité du cuivre: 1.72e-8 Ω·m, aluminium: 2.65e-8 Ω·m
    const resistivity = material === 'CUIVRE' ? 1.72e-8 : 2.65e-8;
    const theoreticalR_per_km = (resistivity * 1000) / (section_mm2 * 1e-6); // Ω/km
    
    // Estimation empirique: I_max ≈ K × √(section) avec K ajusté par matériau
    const K = material === 'CUIVRE' ? 19 : 16; // Coefficients empiriques
    return Math.round(K * Math.sqrt(section_mm2));
  }

  /**
   * Extrait la section d'un type de câble basé sur sa résistance
   */
  private extractSectionFromCableType(cableType: CableType): number {
    // Approximation basée sur la résistance pour extraire la section
    // Résistivité Cu: 1.72e-8 Ω·m, Al: 2.65e-8 Ω·m
    const resistivity = cableType.matiere === 'CUIVRE' ? 1.72e-8 : 2.65e-8;
    const R_ohm_per_km = cableType.R12_ohm_per_km;
    
    // Section = ρ × L / R, avec L = 1000m
    const section_m2 = (resistivity * 1000) / R_ohm_per_km;
    const section_mm2 = section_m2 * 1e6; // Conversion m² -> mm²
    
    return Math.round(section_mm2);
  }
  /**
   * Obtient ou calcule la matrice d'impédance avec mise en cache
   */
  private getOrCalculateImpedanceMatrix(networkHash: string, nodes: Node[], cables: Cable[], cableTypes: CableType[]): Complex[][] {
    if (!this.impedanceMatrixCache.has(networkHash)) {
      const matrix = this.calculateImpedanceMatrix(nodes, cables, cableTypes);
      this.impedanceMatrixCache.set(networkHash, matrix);
    }
    return this.impedanceMatrixCache.get(networkHash)!;
  }

  /**
   * Calcule la matrice d'impédance du réseau (pour optimisations futures)
   */
  private calculateImpedanceMatrix(nodes: Node[], cables: Cable[], cableTypes: CableType[]): Complex[][] {
    const n = nodes.length;
    const matrix: Complex[][] = Array(n).fill(null).map(() => Array(n).fill(C(0, 0)));
    
    // Pour l'instant, matrice d'identité - à implémenter selon les besoins
    for (let i = 0; i < n; i++) {
      matrix[i][i] = C(1, 0);
    }
    
    return matrix;
  }

  /**
   * Génère un hash du réseau pour la mise en cache
   */
  private generateNetworkHash(nodes: Node[], cables: Cable[]): string {
    const nodeHash = nodes.map(n => `${n.id}-${n.connectionType}`).join(',');
    const cableHash = cables.map(c => `${c.id}-${c.typeId}-${c.nodeAId}-${c.nodeBId}`).join(',');
    return `${nodeHash}|${cableHash}`;
  }
  /**
   * Crée une armoire de régulation par défaut pour un nœud
   */
  createDefaultRegulator(nodeId: string, voltageSystem: VoltageSystem): VoltageRegulator {
    // Pour un réseau TRIPHASÉ_230V: tension ligne = 230V, régulateur 77kVA
    // Pour un réseau TÉTRAPHASÉ_400V: tension ligne = 400V, régulateur 44kVA
    const type: RegulatorType = voltageSystem === 'TRIPHASÉ_230V' ? '230V_77kVA' : '400V_44kVA';
    const maxPower = voltageSystem === 'TRIPHASÉ_230V' ? 77 : 44;
    const targetVoltage = voltageSystem === 'TRIPHASÉ_230V' ? 230 : 400;

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
