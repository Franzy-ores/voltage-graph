import { SRG2Config, SRG2Result, Project, CalculationResult, Node, Cable, LoadModel } from '@/types/network';

/**
 * SRG2 Voltage Regulator - Simplified and focused implementation
 * Handles voltage regulation based on measured node voltages
 */
export class SRG2Regulator {
  
  /**
   * Apply SRG2 regulation to a specific node
   */
  apply(
    config: SRG2Config,
    originalVoltage: number,
    project: Project,
    baselineResult: CalculationResult
  ): SRG2Result {
    console.log(`🔧 SRG2 Regulator applying to node ${config.nodeId}, voltage: ${originalVoltage.toFixed(1)}V`);
    
    // Determine network type from project configuration
    const networkType = this.determineNetworkType(project);
    const thresholds = this.getVoltageThresholds(networkType);
    
    console.log(`🔧 SRG2 Network Type: ${networkType}, Load Model: ${project.loadModel || 'polyphase_equilibre'}`);
    console.log(`🔧 SRG2 Thresholds:`, thresholds);
    
    // Determine regulation state based on voltage
    const { state, ratio } = this.calculateRegulation(originalVoltage, thresholds);
    
    // Calculate regulated voltages per phase based on network type and load model
    const { regulatedVoltages, phaseRatios } = this.calculateRegulatedVoltages(
      originalVoltage, ratio, networkType, project.loadModel || 'polyphase_equilibre'
    );
    
    const isActive = state !== 'BYP' && ratio !== 1.0;
    
    console.log(`📊 SRG2 Result - State: ${state}, Ratio: ${ratio.toFixed(3)}, Active: ${isActive}`);
    console.log(`📊 SRG2 Regulated Voltages: A=${regulatedVoltages.A.toFixed(1)}V, B=${regulatedVoltages.B.toFixed(1)}V, C=${regulatedVoltages.C.toFixed(1)}V`);
    
    return {
      nodeId: config.nodeId,
      state,
      ratio,
      isActive,
      originalVoltage,
      regulatedVoltage: regulatedVoltages.A, // Primary voltage for backward compatibility
      powerDownstream_kVA: this.calculateDownstreamPower(config.nodeId, project, baselineResult),
      regulatedVoltages,
      phaseRatios,
      diversifiedLoad_kVA: this.calculateDiversifiedLoad(config.nodeId, project, baselineResult),
      diversifiedProduction_kVA: this.calculateDiversifiedProduction(config.nodeId, project, baselineResult),
      netPower_kVA: this.calculateNetPower(config.nodeId, project, baselineResult),
      networkType
    };
  }
  
  /**
   * Get voltage thresholds for different network types
   */
  private getVoltageThresholds(networkType: string) {
    // All thresholds are in phase-neutral voltages
    // For 230V polyphase: direct phase-neutral (230V between phases)
    // For 400V systems: phase-neutral is ~230V, phase-phase is 400V
    // For monophase systems: depends on connection type
    
    if (networkType === '230V_MONO' || networkType === '230V_POLY') {
      return {
        // 230V system thresholds (phase-neutral for polyphase, phase-phase for monophase)
        BO2_threshold: 210,  // Strong boost needed
        BO1_threshold: 220,  // Light boost needed  
        BYP_low: 225,        // Normal range low
        BYP_high: 235,       // Normal range high
        LO1_threshold: 240,  // Light reduction needed
        LO2_threshold: 250   // Strong reduction needed
      };
    } else if (networkType === '400V_MONO') {
      return {
        // 400V monophase thresholds (phase-phase voltage)
        BO2_threshold: 365,  // Strong boost needed (400V * 0.9125) 
        BO1_threshold: 380,  // Light boost needed (400V * 0.95)
        BYP_low: 390,        // Normal range low (400V * 0.975)
        BYP_high: 410,       // Normal range high (400V * 1.025)
        LO1_threshold: 420,  // Light reduction needed (400V * 1.05)
        LO2_threshold: 440   // Strong reduction needed (400V * 1.1)
      };
    } else {
      return {
        // 400V polyphase thresholds (phase-neutral ~230V)
        BO2_threshold: 210,  
        BO1_threshold: 220,
        BYP_low: 225,
        BYP_high: 235, 
        LO1_threshold: 240,
        LO2_threshold: 250
      };
    }
  }
  
  /**
   * Calculate regulation state and ratio based on voltage and thresholds
   */
  private calculateRegulation(voltage: number, thresholds: any): { state: string; ratio: number } {
    if (voltage <= thresholds.BO2_threshold) {
      return { state: 'BO2', ratio: 1.075 }; // +7.5% boost
    } else if (voltage <= thresholds.BO1_threshold) {
      return { state: 'BO1', ratio: 1.0375 }; // +3.75% boost
    } else if (voltage >= thresholds.LO2_threshold) {
      return { state: 'LO2', ratio: 0.925 }; // -7.5% reduction
    } else if (voltage >= thresholds.LO1_threshold) {
      return { state: 'LO1', ratio: 0.9625 }; // -3.75% reduction
    } else {
      return { state: 'BYP', ratio: 1.0 }; // Normal - no regulation
    }
  }
  
  /**
   * Get descendants of a node in the network
   */
  getDescendants(nodeId: string, nodes: Node[], cables: Cable[]): string[] {
    const descendants: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [nodeId];
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      
      // Find cables connected to this node
      const connectedCables = cables.filter(cable => 
        cable.nodeAId === currentId || cable.nodeBId === currentId
      );
      
      for (const cable of connectedCables) {
        const otherNodeId = cable.nodeAId === currentId ? cable.nodeBId : cable.nodeAId;
        if (!visited.has(otherNodeId) && otherNodeId !== nodeId) {
          descendants.push(otherNodeId);
          queue.push(otherNodeId);
        }
      }
    }
    
    return descendants;
  }

  /**
   * Determine network type from project configuration
   */
  private determineNetworkType(project: Project): string {
    const voltageSystem = project.voltageSystem;
    const loadModel = project.loadModel || 'polyphase_equilibre';
    
    if (voltageSystem === 'TRIPHASÉ_230V') {
      return loadModel === 'monophase_reparti' ? '230V_MONO' : '230V_POLY';
    } else if (voltageSystem === 'TÉTRAPHASÉ_400V') {
      return loadModel === 'monophase_reparti' ? '400V_MONO' : '400V_POLY';
    }
    
    // Default fallback
    return '400V_POLY';
  }

  /**
   * Calculate regulated voltages per phase based on network type
   */
  private calculateRegulatedVoltages(
    originalVoltage: number, 
    ratio: number, 
    networkType: string, 
    loadModel: LoadModel
  ): { regulatedVoltages: { A: number; B: number; C: number }; phaseRatios: { A: number; B: number; C: number } } {
    
    if (loadModel === 'monophase_reparti') {
      // For distributed monophase systems, apply regulation individually per phase
      return {
        regulatedVoltages: {
          A: originalVoltage * ratio,
          B: originalVoltage * ratio,
          C: originalVoltage * ratio
        },
        phaseRatios: {
          A: ratio,
          B: ratio, 
          C: ratio
        }
      };
    } else {
      // For balanced polyphase systems, apply uniform regulation
      const regulatedVoltage = originalVoltage * ratio;
      return {
        regulatedVoltages: {
          A: regulatedVoltage,
          B: regulatedVoltage,
          C: regulatedVoltage
        },
        phaseRatios: {
          A: ratio,
          B: ratio,
          C: ratio
        }
      };
    }
  }

  /**
   * Propagate voltage changes to downstream nodes
   */
  propagateVoltageToChildren(nodeId: string, nodes: Node[], cables: Cable[], ratio: number): void {
    const descendants = this.getDescendants(nodeId, nodes, cables);
    
    for (const descendantId of descendants) {
      const node = nodes.find(n => n.id === descendantId);
      if (node && node.tensionCible) {
        node.tensionCible = node.tensionCible * ratio;
        console.log(`🔄 Propagated voltage to ${descendantId}: ${node.tensionCible.toFixed(1)}V`);
      }
    }
  }

  /**
   * Calculate downstream power consumption
   */
  private calculateDownstreamPower(nodeId: string, project: Project, baselineResult: CalculationResult): number {
    const descendants = this.getDescendants(nodeId, project.nodes, project.cables);
    let totalPower = 0;
    
    for (const descendantId of descendants) {
      const descendantNode = project.nodes.find(n => n.id === descendantId);
      if (descendantNode) {
        // Use nominal power from node as approximation for load/production
        const nominalPower = (descendantNode as any).puissanceNominale_kW || 0;
        totalPower += nominalPower;
      }
    }
    
    return totalPower;
  }

  /**
   * Calculate diversified load
   */
  private calculateDiversifiedLoad(nodeId: string, project: Project, baselineResult: CalculationResult): number {
    const diversificationFactor = 0.8; // Standard diversification factor
    return this.calculateDownstreamPower(nodeId, project, baselineResult) * diversificationFactor;
  }

  /**
   * Calculate diversified production
   */
  private calculateDiversifiedProduction(nodeId: string, project: Project, baselineResult: CalculationResult): number {
    const descendants = this.getDescendants(nodeId, project.nodes, project.cables);
    let totalProduction = 0;
    
    for (const descendantId of descendants) {
      const descendantNode = project.nodes.find(n => n.id === descendantId);
      if (descendantNode) {
        // Use nominal production power from node as approximation
        const nominalProduction = (descendantNode as any).puissanceNominaleProduction_kW || 0;
        totalProduction += nominalProduction;
      }
    }
    
    return totalProduction * 0.9; // Production diversification factor
  }

  /**
   * Calculate net power (load - production)
   */
  private calculateNetPower(nodeId: string, project: Project, baselineResult: CalculationResult): number {
    const load = this.calculateDiversifiedLoad(nodeId, project, baselineResult);
    const production = this.calculateDiversifiedProduction(nodeId, project, baselineResult);
    return load - production;
  }

  /**
   * Reset internal state (for multi-iteration calculations)
   */
  reset(): void {
    console.log('🔄 SRG2 Regulator reset');
  }
}