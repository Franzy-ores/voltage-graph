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
  RegulatorType 
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
   * Calcule un scénario en intégrant les équipements de simulation dans l'algorithme BFS
   */
  private calculateScenarioWithEquipment(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): CalculationResult {
    // Cloner les nœuds et câbles pour ne pas modifier l'original
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

    // Calculer avec l'algorithme standard d'abord
    let result = this.calculateScenario(
      modifiedNodes,
      modifiedCables,
      modifiedCableTypes,
      scenario,
      project.foisonnementCharges,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent
    );

    // Appliquer les armoires de régulation et compensateurs de neutre
    if (equipment.regulators.length > 0 || equipment.neutralCompensators.length > 0) {
      result = this.applySimulationEquipment(
        modifiedNodes,
        modifiedCables,
        modifiedCableTypes,
        result,
        equipment,
        project
      );
    }

    return result;
  }

  /**
   * Applique les équipements de simulation (armoires de régulation et compensateurs de neutre)
   * dans l'algorithme BFS
   */
  private applySimulationEquipment(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    baseResult: CalculationResult,
    equipment: SimulationEquipment,
    project: Project
  ): CalculationResult {
    const activeRegulators = equipment.regulators.filter(r => r.enabled);
    const activeCompensators = equipment.neutralCompensators.filter(c => c.enabled);
    
    if (activeRegulators.length === 0 && activeCompensators.length === 0) {
      return baseResult;
    }

    // Algorithme BFS modifié avec intégration des équipements
    // Ceci est une version simplifiée qui pourrait être étendue
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    
    // Appliquer les armoires de régulation
    const updatedResult = { ...baseResult };
    
    for (const regulator of activeRegulators) {
      const node = nodeById.get(regulator.nodeId);
      if (!node || !baseResult.nodeMetrics) continue;

      const nodeMetric = baseResult.nodeMetrics.find(m => m.nodeId === regulator.nodeId);
      if (!nodeMetric) continue;

      // Calculer l'écart de tension
      const currentVoltage = nodeMetric.V_phase_V;
      const targetVoltage = regulator.targetVoltage_V;
      const voltageError = targetVoltage - currentVoltage;
      
      // Calculer Q nécessaire (approximation simplifiée)
      const maxQ_kVAr = regulator.maxPower_kVA;
      const gainQ = 0.1; // Gain de régulation (à calibrer)
      const requiredQ_kVAr = Math.min(Math.abs(voltageError * gainQ), maxQ_kVAr) * Math.sign(voltageError);
      
      // Mise à jour des résultats (simulation simplifiée)
      // Dans une implémentation complète, il faudrait refaire le BFS
      const voltageImprovement = requiredQ_kVAr * 0.01; // Approximation
      nodeMetric.V_phase_V = Math.min(targetVoltage, currentVoltage + voltageImprovement);
      
      // Mettre à jour les données du régulateur
      regulator.currentQ_kVAr = requiredQ_kVAr;
      regulator.currentVoltage_V = nodeMetric.V_phase_V;
      regulator.isLimited = Math.abs(requiredQ_kVAr) >= maxQ_kVAr * 0.95;
    }

    // Appliquer les compensateurs de neutre
    for (const compensator of activeCompensators) {
      const node = nodeById.get(compensator.nodeId);
      if (!node) continue;

      // Simulation simplifiée de la compensation de neutre
      // Dans une implémentation complète, il faudrait calculer I_N par phase
      const estimatedIN_A = 10; // Valeur simulée
      
      if (estimatedIN_A > compensator.tolerance_A) {
        const reductionFactor = Math.min(0.8, compensator.maxPower_kVA / 20); // Approximation
        const finalIN_A = estimatedIN_A * (1 - reductionFactor);
        
        compensator.currentIN_A = finalIN_A;
        compensator.reductionPercent = (1 - finalIN_A / estimatedIN_A) * 100;
        compensator.compensationQ_kVAr = {
          A: compensator.maxPower_kVA / 3 * 0.3,
          B: compensator.maxPower_kVA / 3 * 0.2,
          C: compensator.maxPower_kVA / 3 * 0.1
        };
      } else {
        compensator.currentIN_A = estimatedIN_A;
        compensator.reductionPercent = 0;
        compensator.compensationQ_kVAr = { A: 0, B: 0, C: 0 };
      }
    }

    return updatedResult;
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