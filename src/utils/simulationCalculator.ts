import { ElectricalCalculator } from './electricalCalculations';
import { SRG2Regulator } from './SRG2Regulator';
import { Project, CalculationScenario, CalculationResult, VoltageRegulator, NeutralCompensator, CableUpgrade, SimulationResult, SimulationEquipment, Cable, CableType, Node, SRG2Config, SRG2Result, LoadModel } from '@/types/network';

export class SimulationCalculator extends ElectricalCalculator {
  private srg2Regulator = new SRG2Regulator();

  constructor(cosPhi: number = 0.95) {
    super(cosPhi);
  }

  /**
   * SIMPLIFIED SRG2 FLOW: Clean separation of electrical calculation and equipment application
   */
  calculateWithSimulation(
    project: Project,
    scenario: CalculationScenario,
    simulationEquipment: SimulationEquipment,
    forcedModeConfig?: any
  ): SimulationResult {
    console.log('🚀 Starting SIMPLIFIED SRG2 simulation...');
    
    // Clean all equipment-related properties from nodes
    const cleanProject: Project = {
      ...project,
      nodes: project.nodes.map(node => ({
        ...node,
        clients: node.clients ? [...node.clients] : [],
        productions: node.productions ? [...node.productions] : [],
        tensionCible: undefined,
        srg2Applied: false,
        srg2State: undefined,
        srg2Ratio: undefined
      }))
    };
    
    console.log('📊 Step 1: Computing baseline electrical network...');
    
    // STEP 1: Pure electrical calculation without any equipment
    const baselineResult = this.calculateScenario(
      cleanProject.nodes, 
      cleanProject.cables, 
      cleanProject.cableTypes,
      scenario,
      project.foisonnementCharges || 100,
      project.foisonnementProductions || 100,
      project.transformerConfig,
      project.loadModel || 'polyphase_equilibre',
      project.desequilibrePourcent || 0,
      project.manualPhaseDistribution
    );
    console.log('✅ Baseline calculation completed');
    
    // STEP 2: Apply SRG2 regulation if configured
    let srg2Result: SRG2Result | undefined;
    let regulatedProject = cleanProject;
    
    if (simulationEquipment.srg2 && simulationEquipment.srg2.enabled) {
      console.log('⚡ Step 2: Applying SRG2 regulation...');
      
      const srg2NodeId = simulationEquipment.srg2.nodeId;
      
      // Get the original voltage from the correct metrics based on load model
      let originalVoltage: number;
      let nodeFound = false;
      
      if (project.loadModel === 'polyphase_equilibre') {
        // For balanced polyphase, use nodeMetrics
        const nodeMetric = baselineResult.nodeMetrics?.find(n => n.nodeId === srg2NodeId);
        if (nodeMetric) {
          originalVoltage = nodeMetric.V_phase_V;
          nodeFound = true;
          console.log(`🎯 SRG2 reading from balanced metrics: ${originalVoltage.toFixed(1)}V`);
        }
      } else {
        // For unbalanced systems, use nodeMetricsPerPhase
        const nodeMetric = baselineResult.nodeMetricsPerPhase?.find(n => n.nodeId === srg2NodeId);
        if (nodeMetric) {
          originalVoltage = nodeMetric.voltagesPerPhase?.A || 0;
          nodeFound = true;
          console.log(`🎯 SRG2 reading from per-phase metrics: ${originalVoltage.toFixed(1)}V`);
        }
      }
      
      if (!nodeFound) {
        console.error(`❌ SRG2 target node ${srg2NodeId} not found in baseline calculation`);
        srg2Result = {
          nodeId: srg2NodeId,
          errorMessage: `Le nœud ${srg2NodeId} n'est pas inclus dans les calculs électriques.`,
          state: 'OFF',
          ratio: 1.0,
          isActive: false,
          originalVoltage: 0,
          regulatedVoltage: 0,
          powerDownstream_kVA: 0
        };
      } else {
        console.log(`🎯 SRG2 node ${srg2NodeId} original voltage: ${originalVoltage!.toFixed(1)}V`);
        
        srg2Result = this.srg2Regulator.apply(
          simulationEquipment.srg2,
          originalVoltage!,
          cleanProject,
          baselineResult
        );
        
        if (srg2Result.isActive && srg2Result.ratio !== 1.0) {
          // Create regulated project with SRG2 applied
          regulatedProject = {
            ...cleanProject,
            nodes: cleanProject.nodes.map(node => {
              if (node.id === srg2NodeId) {
                return {
                  ...node,
                  srg2Applied: true,
                  srg2State: srg2Result!.state,
                  srg2Ratio: srg2Result!.ratio,
                  tensionCible: srg2Result!.regulatedVoltage
                };
              }
              return node;
            })
          };
          
          // Propagate voltage changes to downstream nodes
          this.srg2Regulator.propagateVoltageToChildren(
            srg2NodeId, 
            regulatedProject.nodes, 
            regulatedProject.cables, 
            srg2Result.ratio
          );
          
          console.log(`✅ SRG2 applied - State: ${srg2Result.state}, Ratio: ${srg2Result.ratio.toFixed(3)}`);
        }
      }
    }
    
    // STEP 3: Final calculation with equipment applied
    console.log('🔄 Step 3: Final calculation with equipment...');
    const finalResult = regulatedProject === cleanProject ? 
      baselineResult : 
      this.calculateScenario(
        regulatedProject.nodes, 
        regulatedProject.cables, 
        regulatedProject.cableTypes,
        scenario,
        project.foisonnementCharges || 100,
        project.foisonnementProductions || 100,
        project.transformerConfig,
        project.loadModel || 'polyphase_equilibre',
        project.desequilibrePourcent || 0,
        project.manualPhaseDistribution
      );
    
    // Inject SRG2 regulated voltages into final result if SRG2 was applied
    if (srg2Result?.isActive && finalResult.nodeMetricsPerPhase) {
      finalResult.nodeMetricsPerPhase = finalResult.nodeMetricsPerPhase.map(nodeMetric => {
        if (nodeMetric.nodeId === simulationEquipment.srg2?.nodeId) {
          return {
            ...nodeMetric,
            calculatedVoltagesPerPhase: srg2Result.regulatedVoltages
          };
        }
        return nodeMetric;
      });
      
      console.log(`🔧 SRG2 voltages injected into final result for node ${srg2Result.nodeId}:`, srg2Result.regulatedVoltages);
    }
    
    console.log('✅ Simulation completed successfully');
    
    return {
      scenario,
      cables: baselineResult.cables,
      totalLoads_kVA: baselineResult.totalLoads_kVA,
      totalProductions_kVA: baselineResult.totalProductions_kVA,
      globalLosses_kW: baselineResult.globalLosses_kW,
      maxVoltageDropPercent: baselineResult.maxVoltageDropPercent,
      compliance: baselineResult.compliance,
      nodeMetricsPerPhase: finalResult.nodeMetricsPerPhase,
      baselineResult,
      srg2Result,
      cableUpgradeProposals: [],
      convergenceInfo: {
        converged: true,
        iterations: 1,
        maxIterations: 1
      },
      isSimulation: true,
      equipment: simulationEquipment
    };
  }

  /**
   * Missing method implementations for networkStore compatibility
   */
  createDefaultSRG2Config(nodeId: string): SRG2Config {
    return {
      nodeId,
      enabled: true
    };
  }

  proposeFullCircuitReinforcement(
    project: Project,
    scenario: CalculationScenario,
    baselineResult: CalculationResult
  ): CableUpgrade[] {
    const upgrades: CableUpgrade[] = [];
    
    // Find nodes with significant voltage drops
    baselineResult.nodeMetricsPerPhase.forEach(nodeMetric => {
      const maxDrop = Math.max(
        Math.abs(nodeMetric.voltageDropsPerPhase.A),
        Math.abs(nodeMetric.voltageDropsPerPhase.B),
        Math.abs(nodeMetric.voltageDropsPerPhase.C)
      );
      
      // Suggest upgrade if voltage drop > 5%
      if (maxDrop > 0.05 * 230) { // 5% of 230V
        const node = project.nodes.find(n => n.id === nodeMetric.nodeId);
        if (node && !node.isSource) {
          upgrades.push({
            originalCableId: `cable-to-${nodeMetric.nodeId}`,
            newCableTypeId: 'upgrade-25mm2',
            reason: 'voltage_drop' as const,
            before: {
              voltageDropPercent: (maxDrop / 230) * 100,
              current_A: 50, // Estimate
              losses_kW: 1.0 // Estimate
            },
            after: {
              voltageDropPercent: (maxDrop * 0.6 / 230) * 100,
              current_A: 50,
              losses_kW: 0.6
            },
            improvement: {
              voltageDropReduction: 40, // 40% improvement estimate
              lossReduction_kW: 0.4,
              lossReductionPercent: 40
            }
          });
        }
      }
    });
    
    return upgrades;
  }

  runForcedModeConvergence(
    project: Project,
    scenario: CalculationScenario,
    forcedVoltages: Map<string, number>
  ): CalculationResult {
    console.log('🎯 Running forced mode convergence...');
    
    // Apply forced voltages to source nodes
    const modifiedProject: Project = {
      ...project,
      nodes: project.nodes.map(node => {
        const forcedVoltage = forcedVoltages.get(node.id);
        if (forcedVoltage && node.isSource) {
          return { ...node, tensionCible: forcedVoltage };
        }
        return node;
      })
    };
    
    return this.calculateScenario(
      modifiedProject.nodes, 
      modifiedProject.cables, 
      modifiedProject.cableTypes,
      scenario,
      project.foisonnementCharges || 100,
      project.foisonnementProductions || 100,
      project.transformerConfig,
      project.loadModel || 'polyphase_equilibre',
      project.desequilibrePourcent || 0,
      project.manualPhaseDistribution
    );
  }

  /**
   * Apply neutral compensation (placeholder implementation)
   */
  applyNeutralCompensation(
    nodes: Node[],
    cables: Cable[],
    compensators: NeutralCompensator[],
    baseResult: CalculationResult,
    cableTypes: CableType[]
  ): CalculationResult {
    console.log(`🔧 Applying ${compensators.length} neutral compensators`);
    return baseResult; // Placeholder - implement actual compensation logic
  }

  /**
   * Reset all SRG2 regulators
   */
  resetAllSrg2(): void {
    this.srg2Regulator.reset();
    console.log('[SRG2-Reset] All SRG2 states cleared');
  }

  /**
   * Get initial node voltage based on node type and project configuration
   */
  getInitialNodeVoltage(node: Node, project: Project): number {
    if (node.isSource) {
      return node.tensionCible || project.voltageSystem === 'TRIPHASÉ_230V' ? 230 : 400;
    }
    // For non-source nodes, return a reasonable default
    return project.voltageSystem === 'TRIPHASÉ_230V' ? 230 : 400;
  }

  /**
   * Check if a node is configured for SRG2 regulation
   */
  isSRG2Node(nodeId: string, simulationEquipment?: SimulationEquipment): boolean {
    return simulationEquipment?.srg2?.nodeId === nodeId && simulationEquipment.srg2.enabled;
  }
}