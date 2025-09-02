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
import { Complex, C, add, sub, mul, div, abs } from '@/utils/complex';

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
    const compensatorStates = new Map<string, { Q_phases: { A: number, B: number, C: number }, IN_A: number, isLimited: boolean }>();
    
    // Initialisation des états
    for (const [nodeId, regulator] of regulators.entries()) {
      regulatorStates.set(nodeId, { Q_kVAr: 0, V_target: regulator.targetVoltage_V, isLimited: false });
    }
    for (const [nodeId, compensator] of compensators.entries()) {
      compensatorStates.set(nodeId, { Q_phases: { A: 0, B: 0, C: 0 }, IN_A: 0, isLimited: false });
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
      
      // 3. Traiter les compensateurs de neutre
      for (const [nodeId, compensator] of compensators.entries()) {
        const currentState = compensatorStates.get(nodeId)!;
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
    currentState: { Q_phases: { A: number, B: number, C: number }, IN_A: number, isLimited: boolean },
    loadModel: LoadModel,
    desequilibrePourcent: number
  ): boolean {
    // Calcul approximatif du courant de neutre IN
    let realIN_A = 0;
    
    if (loadModel === 'monophase_reparti' && desequilibrePourcent > 0) {
      // En mode déséquilibré, estimer IN basé sur les métriques du nœud
      const nodeMetric = result.nodeMetrics?.find(m => m.nodeId === nodeId);
      if (nodeMetric) {
        const baseI = nodeMetric.I_inj_A;
        const d = desequilibrePourcent / 100;
        // IN ≈ courant de déséquilibre
        realIN_A = baseI * d * 0.6; // Facteur empirique ajustable
      }
    } else {
      // Mode équilibré : IN théoriquement nul, mais estimation basée sur charge
      const nodeMetric = result.nodeMetrics?.find(m => m.nodeId === nodeId);
      if (nodeMetric) {
        realIN_A = Math.max(0, nodeMetric.I_inj_A * 0.05); // 5% de déséquilibre résiduel
      }
    }
    
    currentState.IN_A = realIN_A;
    
    if (realIN_A <= compensator.tolerance_A) {
      // IN acceptable, pas de compensation
      currentState.Q_phases = { A: 0, B: 0, C: 0 };
      currentState.isLimited = false;
      return false;
    }
    
    // Calcul de la compensation nécessaire
    const excessIN = realIN_A - compensator.tolerance_A;
    const reductionTarget = Math.min(0.9, excessIN / realIN_A); // Max 90% réduction
    
    // Puissance réactive nécessaire (approximation)
    const requiredQ_total = excessIN * 0.4; // Facteur empirique V*I
    
    if (requiredQ_total <= compensator.maxPower_kVA) {
      // Répartition optimale sur les 3 phases pour minimiser IN
      const Q_A = requiredQ_total * 0.4; // Phase la plus chargée
      const Q_B = requiredQ_total * 0.35;
      const Q_C = requiredQ_total * 0.25;
      
      // Vérifier si changement significatif
      const oldQ_total = currentState.Q_phases.A + currentState.Q_phases.B + currentState.Q_phases.C;
      if (Math.abs(requiredQ_total - oldQ_total) > 0.1) {
        currentState.Q_phases = { A: Q_A, B: Q_B, C: Q_C };
        currentState.isLimited = false;
        return true;
      }
    } else {
      // Limitation par puissance max
      const maxQ = compensator.maxPower_kVA;
      currentState.Q_phases = {
        A: maxQ * 0.4,
        B: maxQ * 0.35,
        C: maxQ * 0.25
      };
      currentState.isLimited = true;
      return true;
    }
    
    return false;
  }

  /**
   * Applique les états des équipements aux nœuds pour le calcul
   */
  private applyEquipmentToNodes(
    originalNodes: Node[],
    regulatorStates: Map<string, { Q_kVAr: number, V_target: number, isLimited: boolean }>,
    compensatorStates: Map<string, { Q_phases: { A: number, B: number, C: number }, IN_A: number, isLimited: boolean }>
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
    compensatorStates: Map<string, { Q_phases: { A: number, B: number, C: number }, IN_A: number, isLimited: boolean }>
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