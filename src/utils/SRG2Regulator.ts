import { SRG2Config, SRG2Result, Project, CalculationResult, Node, Cable, LoadModel } from '@/types/network';
import { getSRG2VoltageThresholds, calculateSRG2Regulation } from './voltageDisplay';

/**
 * SRG2 Voltage Regulator - Unified implementation with consistent voltage references
 * Uses centralized voltage reference system for all network types
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
    const DEBUG = typeof window !== 'undefined' && (window as any).DEBUG_CALC === '1';
    if (DEBUG) console.log(`🔧 SRG2 Regulator applying to node ${config.nodeId}, voltage: ${originalVoltage.toFixed(1)}V`);
    
    // Use external unified regulation calculation from voltageDisplay module
    const { state, ratio } = calculateSRG2Regulation(originalVoltage);
    
    if (DEBUG) {
      console.log(`🔧 SRG2 regulation calculated via external voltageDisplay module`);
      console.log(`🔧 SRG2 Network: ${project.voltageSystem}, Load Model: ${project.loadModel || 'polyphase_equilibre'}`);
    }
    
    // Extract per-phase voltages from baseline result
    const nodeResult = baselineResult.nodeMetricsPerPhase[config.nodeId];
    const perPhaseVoltages = nodeResult ? {
      A: nodeResult.A?.voltage || originalVoltage,
      B: nodeResult.B?.voltage || originalVoltage,
      C: nodeResult.C?.voltage || originalVoltage
    } : {
      A: originalVoltage,
      B: originalVoltage, 
      C: originalVoltage
    };
    
    // Calculate regulated voltages per phase
    const { regulatedVoltages, phaseRatios } = this.calculateRegulatedVoltages(
      perPhaseVoltages, ratio, project.loadModel || 'polyphase_equilibre'
    );
    
    const isActive = state !== 'BYP'; // SRG2 is active only when regulating (not in BYP mode)
    
    if (DEBUG) {
      console.log(`📊 SRG2 Result - State: ${state}, Ratio: ${ratio.toFixed(3)}, Active: ${isActive}`);
      console.log(`📊 SRG2 Regulated Voltages: A=${regulatedVoltages.A.toFixed(1)}V, B=${regulatedVoltages.B.toFixed(1)}V, C=${regulatedVoltages.C.toFixed(1)}V`);
    }
    
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
      networkType: project.voltageSystem === 'TÉTRAPHASÉ_400V' ? '400V' : '230V'
    };
  }
  
  // T6: Dead code methods removed - regulation logic now handled by voltageDisplay module
  
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

  // T6: determineNetworkType method removed - no longer needed with unified system

  /**
   * Calculate regulated voltages per phase using individual phase voltages
   */
  private calculateRegulatedVoltages(
    perPhaseVoltages: { A: number; B: number; C: number }, 
    ratio: number, 
    loadModel: LoadModel
  ): { regulatedVoltages: { A: number; B: number; C: number }; phaseRatios: { A: number; B: number; C: number } } {
    
    if (loadModel === 'monophase_reparti') {
      // For distributed monophase systems, apply regulation individually to each phase
      return {
        regulatedVoltages: {
          A: perPhaseVoltages.A * ratio,
          B: perPhaseVoltages.B * ratio,
          C: perPhaseVoltages.C * ratio
        },
        phaseRatios: {
          A: ratio,
          B: ratio, 
          C: ratio
        }
      };
    } else {
      // For balanced polyphase systems, apply uniform regulation
      const regulatedVoltage = perPhaseVoltages.A * ratio; // Use phase A as reference
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