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
  LoadModel
} from '@/types/network';
import { ElectricalCalculator } from '@/utils/electricalCalculations';
import { Complex, C, add, sub, mul, div, abs } from '@/utils/complex';

export class SimulationCalculator extends ElectricalCalculator {
  
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

    // Modifier les nœuds pour inclure les puissances réactives des équipements
    const modifiedNodes = nodes.map(node => {
      const regulator = regulatorByNode.get(node.id);
      const compensator = compensatorByNode.get(node.id);
      
      if (!regulator && !compensator) return node;
      
      return {
        ...node,
        // Les équipements seront gérés dans les itérations BFS
        _hasSimulationEquipment: true,
        _regulator: regulator,
        _compensator: compensator
      };
    });

    // Algorithme BFS modifié avec équipements - version simplifiée intégrée
    return this.runEnhancedBFS(
      modifiedNodes, cables, cableTypes, scenario,
      foisonnementCharges, foisonnementProductions,
      transformerConfig, loadModel, desequilibrePourcent,
      regulatorByNode, compensatorByNode
    );
  }

  /**
   * BFS modifié pour intégrer les équipements de simulation
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
    
    // Calculer d'abord avec l'algorithme standard pour avoir une base
    let baseResult = this.calculateScenario(
      nodes, cables, cableTypes, scenario,
      foisonnementCharges, foisonnementProductions,
      transformerConfig, loadModel, desequilibrePourcent
    );

    // Algorithme itératif pour intégrer les équipements
    const maxIterations = 20;
    let converged = false;
    
    for (let iter = 0; iter < maxIterations && !converged; iter++) {
      let hasChanged = false;
      
      // Appliquer les régulateurs de tension (PV nodes)
      for (const regulator of regulators.values()) {
        if (!baseResult.nodeMetrics) continue;
        
        const nodeMetric = baseResult.nodeMetrics.find(m => m.nodeId === regulator.nodeId);
        if (!nodeMetric) continue;

        const currentV = nodeMetric.V_phase_V;
        const targetV = regulator.targetVoltage_V;
        const errorV = targetV - currentV;
        
        // Contrôle proportionnel pour calculer Q nécessaire
        const Kp = 0.5; // Gain proportionnel à ajuster
        let requiredQ = Kp * errorV * regulator.maxPower_kVA / 50; // Normalisation
        
        // Limiter par la puissance maximale
        const maxQ = regulator.maxPower_kVA;
        if (Math.abs(requiredQ) > maxQ) {
          requiredQ = Math.sign(requiredQ) * maxQ;
          regulator.isLimited = true;
        } else {
          regulator.isLimited = false;
        }
        
        // Vérifier si le changement est significatif
        if (Math.abs(requiredQ - (regulator.currentQ_kVAr || 0)) > 0.1) {
          hasChanged = true;
          regulator.currentQ_kVAr = requiredQ;
          regulator.currentVoltage_V = currentV;
          
          // Approximation de l'effet sur la tension (à améliorer avec vraie BFS)
          const voltageImprovement = requiredQ * 0.02; // Gain approximatif
          nodeMetric.V_phase_V = Math.max(0, currentV + voltageImprovement);
        }
      }
      
      // Appliquer les compensateurs de neutre
      for (const compensator of compensators.values()) {
        // Pour une implémentation complète, il faudrait calculer I_N réel
        // Ici on approxime basé sur le déséquilibre du réseau
        
        const baseIN = desequilibrePourcent * 0.1; // Approximation basée sur déséquilibre
        const currentIN = baseIN * (1 - (compensator.reductionPercent || 0) / 100);
        
        if (currentIN > compensator.tolerance_A) {
          const maxReduction = Math.min(0.8, compensator.maxPower_kVA / 30);
          const newReduction = Math.min(maxReduction * 100, 
            (compensator.reductionPercent || 0) + 5);
          
          if (Math.abs(newReduction - (compensator.reductionPercent || 0)) > 0.5) {
            hasChanged = true;
            compensator.reductionPercent = newReduction;
            compensator.currentIN_A = baseIN * (1 - newReduction / 100);
            
            // Répartition approximative du Q sur les phases
            const totalQ = compensator.maxPower_kVA * (newReduction / 100);
            compensator.compensationQ_kVAr = {
              A: totalQ * 0.4,
              B: totalQ * 0.35,
              C: totalQ * 0.25
            };
          }
        }
      }
      
      // Test de convergence
      if (!hasChanged) {
        converged = true;
      }
    }
    
    if (!converged) {
      console.warn('⚠️ Simulation equipment BFS did not converge');
    }

    return baseResult;
  }

  /**
   * Propose automatiquement des améliorations de câbles
   */
  proposeCableUpgrades(
    project: Project,
    result: CalculationResult,
    voltageDropThreshold: number = 8, // %
    overloadThreshold: number = 1.0 // facteur de sécurité
  ): CableUpgrade[] {
    const upgrades: CableUpgrade[] = [];
    const cableTypeById = new Map(project.cableTypes.map(ct => [ct.id, ct]));
    
    // Trier les types de câbles par section (approximation via résistance)
    const sortedCableTypes = [...project.cableTypes].sort((a, b) => 
      a.R12_ohm_per_km - b.R12_ohm_per_km
    );

    for (const cable of result.cables) {
      if (!cable.voltageDropPercent && !cable.current_A) continue;

      const needsUpgrade = 
        (cable.voltageDropPercent && Math.abs(cable.voltageDropPercent) > voltageDropThreshold) ||
        (cable.current_A && cable.current_A > 100 * overloadThreshold); // 100A comme exemple d'I_iz

      if (!needsUpgrade) continue;

      const currentType = cableTypeById.get(cable.typeId);
      if (!currentType) continue;

      // Trouver un type de section supérieure
      const currentTypeIndex = sortedCableTypes.findIndex(ct => ct.id === cable.typeId);
      if (currentTypeIndex === -1) continue;

      // Prendre la section immédiatement supérieure
      const nextType = sortedCableTypes[currentTypeIndex + 1];
      if (!nextType) continue;

      // Estimation des améliorations (simplifié)
      const improvementFactor = currentType.R12_ohm_per_km / nextType.R12_ohm_per_km;
      const newVoltageDropPercent = (cable.voltageDropPercent || 0) / improvementFactor;
      const newLosses_kW = (cable.losses_kW || 0) / (improvementFactor * improvementFactor);

      const reason: CableUpgrade['reason'] = 
        Math.abs(cable.voltageDropPercent || 0) > voltageDropThreshold && (cable.current_A || 0) > 100 * overloadThreshold 
          ? 'both'
          : Math.abs(cable.voltageDropPercent || 0) > voltageDropThreshold 
            ? 'voltage_drop' 
            : 'overload';

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
          estimatedCost: 1500 // Coût estimé par upgrade
        },
        improvement: {
          voltageDropReduction: Math.abs((cable.voltageDropPercent || 0) - newVoltageDropPercent),
          lossReduction_kW: (cable.losses_kW || 0) - newLosses_kW,
          lossReductionPercent: ((cable.losses_kW || 0) - newLosses_kW) / (cable.losses_kW || 1) * 100
        }
      });
    }

    return upgrades;
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