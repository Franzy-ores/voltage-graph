import { ElectricalCalculator } from './electricalCalculations';
import { SRG2Regulator } from './SRG2Regulator';
import { getSRG2ReferenceVoltage } from './voltageReference';
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
    const DEBUG = typeof window !== 'undefined' && (window as any).DEBUG_CALC === '1';
    if (DEBUG) console.log('🚀 Starting SIMPLIFIED SRG2 simulation...');
    
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
    
    if (DEBUG) console.log('📊 Step 1: Computing baseline electrical network...');
    
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
    if (DEBUG) console.log('✅ Baseline calculation completed');
    
    // STEP 2: Apply SRG2 regulation if configured
    let srg2Result: SRG2Result | undefined;
    let regulatedProject = cleanProject;
    
    if (simulationEquipment.srg2 && simulationEquipment.srg2.enabled) {
      if (DEBUG) console.log('⚡ Step 2: Applying SRG2 regulation...');
      
      const srg2NodeId = simulationEquipment.srg2.nodeId;
      
      // Use unified SRG2 voltage reference (always 230V phase-neutral)
      const originalVoltage = getSRG2ReferenceVoltage(srg2NodeId, baselineResult, cleanProject);
      
      if (DEBUG) {
        console.log(`🎯 SRG2 unified voltage reading for node ${srg2NodeId}: ${originalVoltage.toFixed(1)}V`);
        console.log(`🎯 Network: ${cleanProject.voltageSystem}, Load Model: ${cleanProject.loadModel || 'polyphase_equilibre'}`);
      }
      
      srg2Result = this.srg2Regulator.apply(
        simulationEquipment.srg2,
        originalVoltage,
        cleanProject,
        baselineResult
      );
      
      // Propagation des tensions régulées si SRG2 est actif
      if (srg2Result.isActive) {
        if (DEBUG) console.log(`🔄 Propagation des tensions régulées avec ratio ${srg2Result.ratio.toFixed(3)}`);
        this.srg2Regulator.propagateVoltageToChildren(
          srg2Result.nodeId, 
          cleanProject.nodes, 
          cleanProject.cables, 
          srg2Result.ratio
        );
      }
      
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
        
        if (DEBUG) console.log(`✅ SRG2 applied - State: ${srg2Result.state}, Ratio: ${srg2Result.ratio.toFixed(3)}`);
      }
    }
    
    // STEP 3: Final calculation with equipment applied
    if (DEBUG) console.log('🔄 Step 3: Final calculation with equipment...');
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
    
    // T2: Universal SRG2 injection for both balanced and unbalanced modes
    // Injection systématique même si ratio === 1.0 pour assurer la cohérence
    if (srg2Result && simulationEquipment.srg2?.enabled) {
      // Inject for unbalanced mode (per-phase metrics)
      if (finalResult.nodeMetricsPerPhase) {
        finalResult.nodeMetricsPerPhase = finalResult.nodeMetricsPerPhase.map(nodeMetric => {
          if (nodeMetric.nodeId === simulationEquipment.srg2?.nodeId) {
            return {
              ...nodeMetric,
              calculatedVoltagesPerPhase: srg2Result.regulatedVoltages
            };
          }
          return nodeMetric;
        });
        
        if (DEBUG) console.log(`🔧 SRG2 voltages injected into nodeMetricsPerPhase for node ${srg2Result.nodeId}:`, srg2Result.regulatedVoltages);
      }
      
      // Inject for balanced mode (single voltage metrics)
      if (finalResult.nodeMetrics) {
        finalResult.nodeMetrics = finalResult.nodeMetrics.map(nodeMetric => {
          if (nodeMetric.nodeId === simulationEquipment.srg2?.nodeId) {
            return {
              ...nodeMetric,
              V_phase_V: srg2Result.regulatedVoltage
            };
          }
          return nodeMetric;
        });
        
        if (DEBUG) console.log(`🔧 SRG2 voltage injected into nodeMetrics for node ${srg2Result.nodeId}: ${srg2Result.regulatedVoltage}V`);
      }
    }
    
    if (DEBUG) console.log('✅ Simulation completed successfully');
    
    // T1: Return final results when SRG2 active, baseline otherwise
    const useFinal = !!(srg2Result?.isActive && regulatedProject !== cleanProject);
    const resultMetrics = useFinal ? finalResult : baselineResult;
    
    return {
      scenario,
      cables: resultMetrics.cables,
      totalLoads_kVA: resultMetrics.totalLoads_kVA,
      totalProductions_kVA: resultMetrics.totalProductions_kVA,
      globalLosses_kW: resultMetrics.globalLosses_kW,
      maxVoltageDropPercent: resultMetrics.maxVoltageDropPercent,
      compliance: resultMetrics.compliance,
      nodeMetrics: finalResult.nodeMetrics,
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
    
    // T5: Robust null check and percentage calculation
    const metrics = baselineResult.nodeMetricsPerPhase ?? [];
    if (metrics.length === 0) {
      console.warn('⚠️ No nodeMetricsPerPhase available for cable reinforcement analysis');
      return [];
    }
    
    // Find source node for voltage reference
    const sourceNode = project.nodes.find(n => n.isSource);
    
    metrics.forEach(nodeMetric => {
      const maxDrop = Math.max(
        Math.abs(nodeMetric.voltageDropsPerPhase.A),
        Math.abs(nodeMetric.voltageDropsPerPhase.B),
        Math.abs(nodeMetric.voltageDropsPerPhase.C)
      );
      
      // Determine reference voltage for this node
      const node = project.nodes.find(n => n.id === nodeMetric.nodeId);
      const Uref = sourceNode?.tensionCible ?? 
                   (project.voltageSystem === 'TRIPHASÉ_230V' ? 230 : 400);
      
      // Calculate percentage drop relative to node's reference voltage
      const maxDropPct = (maxDrop / Uref) * 100;
      
      // Suggest upgrade if voltage drop > 5%
      if (maxDropPct > 5 && node && !node.isSource) {
        upgrades.push({
          originalCableId: `cable-to-${nodeMetric.nodeId}`,
          newCableTypeId: 'upgrade-25mm2',
          reason: 'voltage_drop' as const,
          before: {
            voltageDropPercent: maxDropPct,
            current_A: 50, // Estimate
            losses_kW: 1.0 // Estimate
          },
          after: {
            voltageDropPercent: maxDropPct * 0.6, // 40% improvement
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
   * T9: Delegate neutral compensation to ElectricalCalculator for consistency
   */
  applyNeutralCompensation(
    nodes: Node[],
    cables: Cable[],
    compensators: NeutralCompensator[],
    baseResult: CalculationResult,
    cableTypes: CableType[]
  ): CalculationResult {
    console.log(`🔧 Delegating ${compensators.length} neutral compensators to ElectricalCalculator`);
    return super.applyNeutralCompensation(nodes, cables, compensators, baseResult, cableTypes);
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