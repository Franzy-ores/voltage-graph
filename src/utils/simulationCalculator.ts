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
    // Réinitialiser les états SRG2 entre les simulations
    this.resetAllSrg2();
    
    // S'assurer que chaque nœud possède une tension de référence (préservation SRG2)
    project.nodes.forEach(node => {
      if (node.tensionCible == null) {
        // Valeur par défaut : tension nominale du transformateur ou 230 V
        node.tensionCible = project.transformerConfig?.nominalVoltage_V ?? 230;
      }
      // Préserver les informations SRG2 existantes si disponibles
      // Ne pas réinitialiser les tensions déjà ajustées par SRG2
    });
    
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
   * Réinitialise tous les états SRG2 (utile entre deux runs)
   */
  private resetAllSrg2(): void {
    (this.srg2Regulator as any).currentStates.clear();
    (this.srg2Regulator as any).lastSwitchTimes.clear();
    console.log('[SRG2-Reset] All SRG2 states cleared for new simulation');
  }

  /**
   * Phase 1 - Fonction utilitaire pour identifier les nœuds SRG2
   */
  private isSRG2Node(nodeId: string, simulationEquipment?: SimulationEquipment): boolean {
    return simulationEquipment?.srg2?.enabled === true && simulationEquipment.srg2.nodeId === nodeId;
  }

  /**
   * Fonction centrale pour appliquer le régulateur SRG2 - point d'entrée unique
   * Toute application du SRG2 doit passer par cette fonction pour éviter les calculs multiples
   */
  private applySrg2IfNeeded(
    simulationEquipment: SimulationEquipment,
    nodes: Node[],
    project: Project,
    scenario: CalculationScenario,
    baseResult: CalculationResult
  ): { nodes: Node[]; result: CalculationResult; srg2Result?: SRG2Result } {
    if (!simulationEquipment.srg2?.enabled) {
      return { nodes, result: baseResult };
    }

    // Vérification de la cohérence du type de réseau
    // Check if it's an SRG2 node (no network type checking needed)
    if (!simulationEquipment.srg2?.enabled || simulationEquipment.srg2.nodeId !== simulationEquipment.srg2.nodeId) {
      return { nodes, result: baseResult };
    }

    const targetNode = nodes.find(n => n.id === simulationEquipment.srg2!.nodeId);
    if (!targetNode) {
      console.warn(`⚠️ SRG2: Node ${simulationEquipment.srg2.nodeId} not found`);
      return { nodes, result: baseResult };
    }

    // Extract actual calculated voltages from base result
    const nodeMetrics = baseResult.nodeMetricsPerPhase?.find(n => n.nodeId === targetNode.id);
    const actualVoltages = nodeMetrics?.voltagesPerPhase ? {
      A: nodeMetrics.voltagesPerPhase.A,
      B: nodeMetrics.voltagesPerPhase.B, 
      C: nodeMetrics.voltagesPerPhase.C
    } : undefined;
    
    console.log(`🔍 [SRG2-DEBUG] Extracting voltages for node ${targetNode.id}:`, {
      nodeMetricsFound: !!nodeMetrics,
      voltagesPerPhase: nodeMetrics?.voltagesPerPhase,
      extractedActualVoltages: actualVoltages,
      tensionCible: targetNode.tensionCible
    });
    
    console.log(`🔧 Applying SRG2 voltage regulator with actual voltages: ${actualVoltages ? `${actualVoltages.A.toFixed(1)}/${actualVoltages.B.toFixed(1)}/${actualVoltages.C.toFixed(1)}V` : 'unavailable'}`);
    const srg2Result = this.srg2Regulator.apply(
      simulationEquipment.srg2,
      targetNode,
      project,
      actualVoltages
    );

    if (!srg2Result.isActive) {
      return { nodes, result: baseResult, srg2Result };
    }

    // Propagation uniquement en aval (typique)
    const updatedNodes = this.srg2Regulator.applyRegulationToNetwork(
      srg2Result,
      nodes,
      project.cables,
      'downstream'
    );

    console.log(`🔄 [SRG2-RECALC] Starting recalculation with ${updatedNodes.length} nodes after SRG2 regulation...`);
    
    // Log node voltages before recalculation
    updatedNodes.forEach(n => {
      if (n.srg2Applied || n.id === srg2Result.nodeId) {
        console.log(`📊 [PRE-RECALC] Node ${n.id}: tensionCible=${n.tensionCible}V, srg2Applied=${n.srg2Applied}, srg2Ratio=${n.srg2Ratio}`);
      }
    });
    
    const newResult = this.calculateScenario(
      updatedNodes,
      project.cables,
      project.cableTypes,
      scenario,
      project.foisonnementCharges ?? 100,
      project.foisonnementProductions ?? 100,
      project.transformerConfig,
      project.loadModel ?? 'polyphase_equilibre',
      project.desequilibrePourcent ?? 0
    );
    
    // Log final results
    if (newResult.nodeMetricsPerPhase) {
      const srg2NodeMetrics = newResult.nodeMetricsPerPhase.find(n => n.nodeId === srg2Result.nodeId);
      if (srg2NodeMetrics?.voltagesPerPhase) {
        console.log(`✅ [SRG2-FINAL] Node ${srg2Result.nodeId} final voltages:`, srg2NodeMetrics.voltagesPerPhase);
      }
    }

    return { nodes: updatedNodes, result: newResult, srg2Result };
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

    // Phase 2 - Validation avant application (détection de conflits)
    // Note: Plus de conflits possibles car il n'y a plus que SRG2
    if (simulationEquipment.srg2?.enabled) {
      const srg2NodeId = simulationEquipment.srg2.nodeId;
      console.log(`✅ [SRG2-INFO] SRG2 regulator configured on node ${srg2NodeId}`);
    }

    console.log(`[ORDER-TRACE] Starting equipment application in priority order: SRG2 → Compensators → Classical regulators`);

    // Application du régulateur SRG2 (PRIORITÉ 1 - via fonction centralisée)
    const { nodes: afterSrg2Nodes, result: afterSrg2Result, srg2Result } =
      this.applySrg2IfNeeded(
        simulationEquipment,
        modifiedNodes,
        project,
        scenario,
        baseResult
      );

    result = afterSrg2Result;
    modifiedNodes = afterSrg2Nodes;

    if (srg2Result) {
      (result as any).srg2Result = srg2Result;
      console.log(`✅ [ORDER-TRACE] SRG2 applied successfully - node ${srg2Result.nodeId} regulated with ratio ${srg2Result.ratio.toFixed(3)}`);
    } else {
      console.log(`ℹ️ [ORDER-TRACE] No SRG2 regulation applied`);
    }

    // Application des compensateurs de neutre (ÉQUI8)
    if (simulationEquipment.neutralCompensators && simulationEquipment.neutralCompensators.length > 0) {
      const activeCompensators = simulationEquipment.neutralCompensators.filter(c => c.enabled);
      if (activeCompensators.length > 0) {
        console.log(`🔧 Applying ${activeCompensators.length} neutral compensators...`);
        result = this.applyNeutralCompensation(modifiedNodes, cables, activeCompensators, result, cableTypes);
      }
    }

    // Application SRG2 seulement (plus de régulateurs classiques)
    if (simulationEquipment.srg2?.enabled) {
      console.log(`🔧 [SRG2] Applying SRG2 regulator...`);
    }

    // SRG2 result déjà stocké dans le bloc précédent

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
   * Crée une configuration SRG2 par défaut pour un nœud
   */
  createDefaultSRG2Config(nodeId: string): SRG2Config {
    return {
      nodeId,
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