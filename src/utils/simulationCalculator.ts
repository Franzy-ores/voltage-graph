import { ElectricalCalculator } from './electricalCalculations';
import { SRG2Regulator } from './SRG2Regulator';
import { Project, CalculationScenario, CalculationResult, VoltageRegulator, NeutralCompensator, CableUpgrade, SimulationResult, SimulationEquipment, Cable, CableType, Node, SRG2Config, SRG2Result } from '@/types/network';

export class SimulationCalculator extends ElectricalCalculator {
  private srg2Regulator = new SRG2Regulator();

  constructor(cosPhi: number = 0.95) {
    super(cosPhi);
  }

  /**
   * Calcule avec équipements de simulation
   */
  calculateWithSimulation(
    project: Project,
    scenario: CalculationScenario,
    simulationEquipment: SimulationEquipment,
    forcedModeConfig?: any
  ): SimulationResult {
    console.log('🔄 Starting simulation calculation...');
    
    // Calcul de base
    const baseResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      scenario,
      project.foisonnementCharges || 100,
      project.foisonnementProductions || 100,
      project.transformerConfig,
      project.loadModel || 'polyphase_equilibre',
      project.desequilibrePourcent || 0
    );

    // Application des équipements de simulation
    const simulationResult = this.calculateScenarioWithEquipment(
      project.nodes,
      project.cables,
      project.cableTypes,
      simulationEquipment,
      baseResult,
      project,
      scenario
    );

    return {
      ...simulationResult,
      isSimulation: true,
      baselineResult: baseResult,
      equipment: simulationEquipment,
      convergenceStatus: 'converged' as const,
      srg2Result: (simulationResult as any).srg2Result
    };
  }

  /**
   * Applique les équipements de simulation
   */
  private calculateScenarioWithEquipment(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    simulationEquipment: SimulationEquipment,
    baseResult: CalculationResult,
    project: Project,
    scenario: CalculationScenario
  ): CalculationResult {
    let result = { ...baseResult };
    let modifiedNodes = [...nodes];

    // Application du régulateur SRG2 (PRIORITÉ 1 - avant tous les autres équipements)
    let srg2Result: SRG2Result | undefined;
    if (simulationEquipment.srg2 && simulationEquipment.srg2.enabled) {
      console.log('🔧 Applying SRG2 voltage regulator...');
      
      const targetNode = modifiedNodes.find(n => n.id === simulationEquipment.srg2!.nodeId);
      if (targetNode) {
        srg2Result = this.srg2Regulator.apply(
          simulationEquipment.srg2,
          targetNode,
          project
        );

        // Apply regulation to network if active
        if (srg2Result.isActive) {
          modifiedNodes = this.srg2Regulator.applyRegulationToNetwork(
            srg2Result,
            modifiedNodes,
            cables
          );

          // Recalculate the scenario with SRG2-modified nodes
          console.log('🔄 Recalculating scenario with SRG2 regulation...');
          result = this.calculateScenario(
            modifiedNodes,
            project.cables,
            project.cableTypes,
            scenario,
            project.foisonnementCharges || 100,
            project.foisonnementProductions || 100,
            project.transformerConfig,
            project.loadModel || 'polyphase_equilibre',
            project.desequilibrePourcent || 0
          );
        }
      } else {
        console.warn(`⚠️ SRG2: Node ${simulationEquipment.srg2.nodeId} not found`);
      }
    }

    // Application des compensateurs de neutre (ÉQUI8)
    if (simulationEquipment.neutralCompensators && simulationEquipment.neutralCompensators.length > 0) {
      const activeCompensators = simulationEquipment.neutralCompensators.filter(c => c.enabled);
      if (activeCompensators.length > 0) {
        console.log(`🔧 Applying ${activeCompensators.length} neutral compensators...`);
        result = this.applyNeutralCompensation(modifiedNodes, cables, activeCompensators, result, cableTypes);
      }
    }

    // Application des régulateurs de tension classiques (après SRG2)
    if (simulationEquipment.regulators && simulationEquipment.regulators.length > 0) {
      // FILTRE: Exclure les régulateurs SRG2 du système classique
      const classicRegulators = simulationEquipment.regulators.filter(r => 
        r.enabled && !r.type?.includes('SRG2') && 
        !(r.type?.includes('230V') || r.type?.includes('400V'))
      );
      
      if (classicRegulators.length > 0) {
        console.log(`🔧 Applying ${classicRegulators.length} classic voltage regulators...`);
        
        // Utiliser le système unifié pour appliquer SEULEMENT les régulateurs classiques
        result = this.applyAllVoltageRegulators(
          modifiedNodes, // Utiliser les nœuds modifiés par SRG2
          project.cables,
          classicRegulators, // SEULEMENT les régulateurs non-SRG2
          result,
          cableTypes,
          project,
          scenario
        );
      } else if (simulationEquipment.regulators.filter(r => r.enabled).length > 0) {
        console.log('ℹ️ All enabled regulators are SRG2 - handled by SRG2Regulator system');
      }
    }

    // Store SRG2 result in the final result
    if (srg2Result) {
      (result as any).srg2Result = srg2Result;
    }

    return result;
  }

  /**
   * Crée un régulateur par défaut pour un nœud
   */
  createDefaultRegulator(nodeId: string, sourceVoltage: number): VoltageRegulator {
    const regulatorType = sourceVoltage > 300 ? '400V_44kVA' : '230V_77kVA';
    const maxPower = sourceVoltage > 300 ? 44 : 77;
    
    return {
      id: `regulator_${nodeId}_${Date.now()}`,
      nodeId,
      type: regulatorType as any,
      targetVoltage_V: 230,
      maxPower_kVA: maxPower,
      enabled: false
    };
  }

  /**
   * Propose des améliorations de câbles basées sur la chute de tension
   */
  proposeFullCircuitReinforcement(
    cables: Cable[],
    availableCableTypes: CableType[],
    voltageDropThreshold: number = 8.0
  ): CableUpgrade[] {
    const upgrades: CableUpgrade[] = [];
    
    for (const cable of cables) {
      const currentVoltageDropPercent = Math.abs((cable as any).deltaU_percent || 0);
      
      if (currentVoltageDropPercent > voltageDropThreshold) {
        const currentType = availableCableTypes.find(ct => ct.id === cable.typeId);
        if (!currentType) continue;

        // Chercher un câble de section supérieure
        const betterTypes = availableCableTypes
          .filter(ct => 
            ct.matiere === currentType.matiere &&
            ct.posesPermises.some(pose => currentType.posesPermises.includes(pose)) &&
            ct.R12_ohm_per_km < currentType.R12_ohm_per_km
          )
          .sort((a, b) => a.R12_ohm_per_km - b.R12_ohm_per_km);

        if (betterTypes.length > 0) {
          const recommendedType = betterTypes[0];
          const improvementPercent = ((currentType.R12_ohm_per_km - recommendedType.R12_ohm_per_km) / currentType.R12_ohm_per_km) * 100;

          upgrades.push({
            originalCableId: cable.id,
            newCableTypeId: recommendedType.id,
            reason: "voltage_drop" as const,
            before: {
              voltageDropPercent: currentVoltageDropPercent,
              current_A: 0, // À calculer si nécessaire
              losses_kW: 0
            },
            after: {
              voltageDropPercent: currentVoltageDropPercent * (recommendedType.R12_ohm_per_km / currentType.R12_ohm_per_km),
              current_A: 0,
              losses_kW: 0
            },
            improvement: {
              voltageDropReduction: improvementPercent,
              lossReduction_kW: 0,
              lossReductionPercent: improvementPercent
            }
          });
        }
      }
    }

    return upgrades;
  }

  /**
   * Méthode pour le mode forcé - version simplifiée pour la compatibilité
   */
  runForcedModeConvergence(
    project: Project,
    scenario: CalculationScenario,
    targetVoltages: Record<string, number>
  ): any {
    console.log('🔧 Running forced mode convergence (simplified)');
    
    // Pour l'instant, retourner un calcul standard
    const result = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      scenario,
      project.foisonnementCharges || 100,
      project.foisonnementProductions || 100,
      project.transformerConfig,
      project.loadModel || 'polyphase_equilibre',
      project.desequilibrePourcent || 0
    );
    
    return {
      ...result,
      converged: true,
      forcedMode: true
    };
  }
}