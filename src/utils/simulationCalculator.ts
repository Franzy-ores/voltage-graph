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
   * Main simulation entry point - handles forced mode, SRG2, and standard calculations
   */
  calculateWithSimulation(
    project: Project,
    scenario: CalculationScenario,
    simulationEquipment: SimulationEquipment,
    forcedModeConfig?: any
  ): SimulationResult {
    const DEBUG = typeof window !== 'undefined' && (window as any).DEBUG_CALC === '1';
    
    // T4: Handle forced mode if configured
    if (scenario === 'FORCÉ' && project.forcedModeConfig) {
      if (DEBUG) console.log('🎯 Running forced mode calibration...');
      return this.runForcedModeSimulation(project, scenario, simulationEquipment);
    }
    
    if (DEBUG) console.log('🚀 Starting SRG2/standard simulation...');
    
    // Clean all equipment-related properties from nodes
    const cleanProject: Project = {
      ...project,
      nodes: project.nodes.map(node => ({
        ...node,
        clients: node.clients ? [...node.clients] : [],
        productions: node.productions ? [...node.productions] : [],
        // ✅ CRITICAL FIX: Only preserve SRG2 properties when SRG2 is enabled AND matches this node
        // This ensures voltages are cleared when SRG2 is disconnected
        tensionCible: simulationEquipment.srg2?.enabled && simulationEquipment.srg2?.nodeId === node.id ? node.tensionCible : undefined,
        srg2Applied: simulationEquipment.srg2?.enabled && simulationEquipment.srg2?.nodeId === node.id ? (node as any).srg2Applied : false,
        srg2State: simulationEquipment.srg2?.enabled && simulationEquipment.srg2?.nodeId === node.id ? (node as any).srg2State : undefined,
        srg2Ratio: simulationEquipment.srg2?.enabled && simulationEquipment.srg2?.nodeId === node.id ? (node as any).srg2Ratio : undefined
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
      
      // T2: Foisonné downstream balance exposed to UI
      const bilan = this.computeDownstreamFoisonnement(cleanProject, srg2Result.nodeId);
      (srg2Result as any).downstreamLoads_kVA       = bilan.loads_kVA;
      (srg2Result as any).downstreamProductions_kVA = bilan.productions_kVA;
      (srg2Result as any).downstreamNet_kVA         = bilan.net_kVA;
      
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
      
      if (srg2Result.isActive) {
        // ✅ CRITICAL FIX: Always apply SRG2 properties when active, even in BYP mode (ratio = 1.0)
        // This ensures the star indicator (*) is always shown for configured SRG2 nodes
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
    
    // T4: Disabled post-calculation SRG2 injection (desynchronizes UI vs calculation)
    // The solver now produces correct downstream voltages thanks to T3 pinning
    if (false && srg2Result && simulationEquipment.srg2?.enabled) {
      // Disabled on purpose: solver's native results already reflect pinned setpoints.
      // If needed temporarily for debugging, flip to `if (DEBUG && ...)`.
    }
    
    if (DEBUG) console.log('✅ Simulation completed successfully');
    
    // T1: Return final results when SRG2 active, baseline otherwise
    // ✅ CRITICAL FIX: Always return finalResult when SRG2 is configured, not just when active
    // This ensures srg2Result and node properties are always available for display
    const useFinal = !!(simulationEquipment.srg2?.enabled && regulatedProject !== cleanProject);
    const resultMetrics = useFinal ? finalResult : baselineResult;
    
    return {
      scenario,
      cables: resultMetrics.cables,
      totalLoads_kVA: resultMetrics.totalLoads_kVA,
      totalProductions_kVA: resultMetrics.totalProductions_kVA,
      globalLosses_kW: resultMetrics.globalLosses_kW,
      maxVoltageDropPercent: resultMetrics.maxVoltageDropPercent,
      compliance: resultMetrics.compliance,
      nodeMetrics: resultMetrics.nodeMetrics,
      nodeMetricsPerPhase: resultMetrics.nodeMetricsPerPhase,
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
   * T2: Compute foisonned downstream balance at the SRG2 node
   */
  private computeDownstreamFoisonnement(
    project: Project,
    rootNodeId: string
  ): { loads_kVA: number; productions_kVA: number; net_kVA: number } {
    const foissC = project.foisonnementCharges ?? 100;
    const foissP = project.foisonnementProductions ?? 100;

    // Build undirected adjacency
    const adj = new Map<string, string[]>();
    for (const n of project.nodes) adj.set(n.id, []);
    for (const c of project.cables) {
      if (adj.has(c.nodeAId) && adj.has(c.nodeBId)) {
        adj.get(c.nodeAId)!.push(c.nodeBId);
        adj.get(c.nodeBId)!.push(c.nodeAId);
      }
    }

    // BFS including the root
    const visited = new Set<string>([rootNodeId]);
    const queue: string[] = [rootNodeId];
    let sumLoads = 0;
    let sumProd  = 0;

    while (queue.length) {
      const u = queue.shift()!;
      const node = project.nodes.find(n => n.id === u);
      if (node) {
        const Su = (node.clients ?? []).reduce((s, c) => s + (c.S_kVA ?? 0), 0) * (foissC / 100);
        const Pu = (node.productions ?? []).reduce((s, p) => s + (p.S_kVA ?? 0), 0) * (foissP / 100);
        sumLoads += Su;
        sumProd  += Pu;
      }
      for (const v of (adj.get(u) ?? [])) {
        if (!visited.has(v)) { visited.add(v); queue.push(v); }
      }
    }

    return {
      loads_kVA: parseFloat(sumLoads.toFixed(2)),
      productions_kVA: parseFloat(sumProd.toFixed(2)),
      net_kVA: parseFloat((sumLoads - sumProd).toFixed(2)),
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

  /**
   * T1: Two-phase forced mode simulation - calibration + imbalance calculation
   */
  private runForcedModeSimulation(
    project: Project, 
    scenario: CalculationScenario, 
    simulationEquipment: SimulationEquipment
  ): SimulationResult {
    const DEBUG = typeof window !== 'undefined' && (window as any).DEBUG_CALC === '1';
    const config = project.forcedModeConfig!;
    
    if (DEBUG) console.log('🎯 Phase 1: Calibrating foisonnement charges...');
    
    // Phase 1: Binary search calibration for foisonnementCharges
    let converged = false;
    let iterations = 0;
    let calibratedFoisonnement = project.foisonnementCharges || 100;
    let voltageError = 0;
    
    if (config.targetVoltage && config.targetVoltage > 0) {
      let low = 0;
      let high = 100;
      const tolerance = 0.1; // ±0.1V tolerance
      const maxIterations = 20;
      
      while (iterations < maxIterations && (high - low) > 0.1) {
        iterations++;
        const testFoisonnement = (low + high) / 2;
        
        // Test calculation with current foisonnement
        const testProject = {
          ...project,
          foisonnementCharges: testFoisonnement,
          foisonnementProductions: 100,
          loadModel: 'monophase_reparti' as LoadModel,
          manualPhaseDistribution: {
            charges: { A: 33.33, B: 33.33, C: 33.33 },
            productions: { A: 33.33, B: 33.33, C: 33.33 },
            constraints: { min: 25, max: 50, total: 100 }
          }
        };
        
        const testResult = this.calculateScenarioWithHTConfig(
          testProject, scenario, testFoisonnement, 100
        );
        
        // Get voltage at measurement node
        const nodeMetric = testResult.nodeMetricsPerPhase?.find(
          m => m.nodeId === config.measurementNodeId
        );
        
        if (nodeMetric) {
          // Use average of three phases for comparison
          const avgVoltage = (nodeMetric.voltagesPerPhase.A + 
                             nodeMetric.voltagesPerPhase.B + 
                             nodeMetric.voltagesPerPhase.C) / 3;
          voltageError = Math.abs(avgVoltage - config.targetVoltage);
          
          if (voltageError <= tolerance) {
            converged = true;
            calibratedFoisonnement = testFoisonnement;
            if (DEBUG) console.log(`✅ Converged: foisonnement=${testFoisonnement.toFixed(1)}%, voltage=${avgVoltage.toFixed(1)}V`);
            break;
          }
          
          if (avgVoltage < config.targetVoltage) {
            high = testFoisonnement; // Reduce load
          } else {
            low = testFoisonnement; // Increase load
          }
          
          if (DEBUG) console.log(`  Iter ${iterations}: foisonnement=${testFoisonnement.toFixed(1)}%, voltage=${avgVoltage.toFixed(1)}V, target=${config.targetVoltage}V`);
        }
      }
    } else {
      // No calibration - use manual foisonnement
      converged = true;
      calibratedFoisonnement = project.foisonnementCharges || 100;
    }
    
    if (DEBUG) console.log('🎯 Phase 2: Computing production distribution from measured voltages...');
    
    // Phase 2: Compute per-phase production distribution from measured voltages
    const { U1, U2, U3 } = config.measuredVoltages;
    const minVoltage = Math.min(U1, U2, U3);
    
    // Calculate elevations and normalize to production percentages
    const elevA = U1 - minVoltage;
    const elevB = U2 - minVoltage;  
    const elevC = U3 - minVoltage;
    const totalElev = elevA + elevB + elevC;
    
    let prodA = 33.33, prodB = 33.33, prodC = 33.33;
    
    if (totalElev > 0.01) { // Avoid division by zero
      prodA = (elevA / totalElev) * 100;
      prodB = (elevB / totalElev) * 100;
      prodC = (elevC / totalElev) * 100;
      
      // Clamp to constraints [25%, 50%]
      prodA = Math.max(25, Math.min(50, prodA));
      prodB = Math.max(25, Math.min(50, prodB));
      prodC = Math.max(25, Math.min(50, prodC));
      
      // Renormalize to 100%
      const total = prodA + prodB + prodC;
      prodA = (prodA / total) * 100;
      prodB = (prodB / total) * 100;
      prodC = (prodC / total) * 100;
    }
    
    if (DEBUG) console.log(`  Production distribution: A=${prodA.toFixed(1)}%, B=${prodB.toFixed(1)}%, C=${prodC.toFixed(1)}%`);
    
    // Final simulation with calibrated parameters
    const finalProject = {
      ...project,
      foisonnementCharges: calibratedFoisonnement,
      foisonnementProductions: 100,
      loadModel: 'monophase_reparti' as LoadModel,
      manualPhaseDistribution: {
        charges: { A: 33.33, B: 33.33, C: 33.33 },
        productions: { A: prodA, B: prodB, C: prodC },
        constraints: { min: 25, max: 50, total: 100 }
      }
    };
    
    const finalResult = this.calculateScenarioWithHTConfig(
      finalProject, scenario, calibratedFoisonnement, 100, finalProject.manualPhaseDistribution
    );
    
    // Calculate voltage errors at measurement node
    const finalNodeMetric = finalResult.nodeMetricsPerPhase?.find(
      m => m.nodeId === config.measurementNodeId
    );
    
    let voltageErrors = { A: 0, B: 0, C: 0 };
    if (finalNodeMetric) {
      voltageErrors = {
        A: Math.abs(finalNodeMetric.voltagesPerPhase.A - U1),
        B: Math.abs(finalNodeMetric.voltagesPerPhase.B - U2),
        C: Math.abs(finalNodeMetric.voltagesPerPhase.C - U3)
      };
    }
    
    // T5: Return consistent results with forced mode extensions
    const extendedResult: CalculationResult = {
      ...finalResult,
      convergenceStatus: converged ? 'converged' : 'not_converged',
      finalLoadDistribution: { A: 33.33, B: 33.33, C: 33.33 },
      finalProductionDistribution: { A: prodA, B: prodB, C: prodC },
      calibratedFoisonnementCharges: calibratedFoisonnement,
      optimizedPhaseDistribution: finalProject.manualPhaseDistribution
    };
    
    return {
      scenario,
      cables: extendedResult.cables,
      totalLoads_kVA: extendedResult.totalLoads_kVA,
      totalProductions_kVA: extendedResult.totalProductions_kVA,
      globalLosses_kW: extendedResult.globalLosses_kW,
      maxVoltageDropPercent: extendedResult.maxVoltageDropPercent,
      compliance: extendedResult.compliance,
      nodeMetrics: extendedResult.nodeMetrics || [],
      nodeMetricsPerPhase: extendedResult.nodeMetricsPerPhase || [],
      convergenceInfo: {
        converged,
        iterations,
        maxIterations: 20
      },
      convergenceStatus: converged ? 'converged' : 'not_converged',
      finalLoadDistribution: { A: 33.33, B: 33.33, C: 33.33 },
      finalProductionDistribution: { A: prodA, B: prodB, C: prodC },
      calibratedFoisonnementCharges: calibratedFoisonnement,
      optimizedPhaseDistribution: finalProject.manualPhaseDistribution,
      isSimulation: true,
      equipment: simulationEquipment
    };
  }

  /**
   * T2: HT-aware scenario calculation wrapper (restores legacy calculateScenarioWithHTConfig)
   */
  private calculateScenarioWithHTConfig(
    project: Project,
    scenario: CalculationScenario, 
    foisonnementCharges: number,
    foisonnementProductions: number,
    manualPhaseDistribution?: any
  ): CalculationResult {
    // Clone nodes to avoid modifying original project
    let modifiedNodes = project.nodes.map(node => ({ ...node }));
    
    // Apply HT voltage configuration if present
    if (project.htVoltageConfig && project.transformerConfig) {
      const sourceNode = modifiedNodes.find(n => n.isSource);
      if (sourceNode && !sourceNode.tensionCible) {
        // Calculate realistic source voltage from HT measurement
        const { nominalVoltageHT_V, nominalVoltageBT_V, measuredVoltageHT_V } = project.htVoltageConfig;
        const voltageRatio = measuredVoltageHT_V / nominalVoltageHT_V;
        const realisticSourceVoltage = nominalVoltageBT_V * voltageRatio;
        
        sourceNode.tensionCible = realisticSourceVoltage;
        console.log(`🔧 HT-aware source voltage: ${realisticSourceVoltage.toFixed(1)}V (ratio: ${voltageRatio.toFixed(3)})`);
      }
    }
    
    return this.calculateScenario(
      modifiedNodes,
      project.cables,
      project.cableTypes,
      scenario,
      foisonnementCharges,
      foisonnementProductions,
      project.transformerConfig,
      project.loadModel || 'polyphase_equilibre',
      project.desequilibrePourcent || 0,
      manualPhaseDistribution
    );
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