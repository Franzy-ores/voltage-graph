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
    console.log(`🔧 SRG2 Regulator applying to node ${config.nodeId}, voltage: ${originalVoltage.toFixed(1)}V`);
    
    // Use unified regulation calculation
    const { state, ratio } = calculateSRG2Regulation(originalVoltage);
    
    console.log(`🔧 SRG2 Network: ${project.voltageSystem}, Load Model: ${project.loadModel || 'polyphase_equilibre'}`);
    console.log(`🔧 SRG2 Unified thresholds used for regulation`);
    
    // Calculate regulated voltages per phase
    const { regulatedVoltages, phaseRatios } = this.calculateRegulatedVoltages(
      originalVoltage, ratio, 'UNIFIED_230V', project.loadModel || 'polyphase_equilibre'
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
      networkType: 'UNIFIED_230V'
    };
  }
  
  /**
   * Get voltage thresholds for different network types
   * CORRECTED: All 400V systems use ~230V phase-neutral reference voltage
   */
  private getVoltageThresholds(networkType: string) {
    console.log(`[SRG2] Getting thresholds for network type: ${networkType}`);
    
    const thresholds = {
      '230V_MONO': {
        BO2_threshold: 218.5, // 95% of 230V
        BO1_threshold: 224.25, // 97.5% of 230V
        BYP_low: 224.25, // 97.5% of 230V
        BYP_high: 235.75, // 102.5% of 230V
        LO1_threshold: 235.75, // 102.5% of 230V
        LO2_threshold: 241.5, // 105% of 230V
        BO2_ratio: 1.055, // +5.5%
        BO1_ratio: 1.025, // +2.5%
        LO1_ratio: 0.975, // -2.5%
        LO2_ratio: 0.945, // -5.5%
      },
      '230V_POLY': {
        BO2_threshold: 218.5, // 95% of 230V
        BO1_threshold: 224.25, // 97.5% of 230V
        BYP_low: 224.25, // 97.5% of 230V
        BYP_high: 235.75, // 102.5% of 230V
        LO1_threshold: 235.75, // 102.5% of 230V
        LO2_threshold: 241.5, // 105% of 230V
        BO2_ratio: 1.055, // +5.5%
        BO1_ratio: 1.025, // +2.5%
        LO1_ratio: 0.975, // -2.5%
        LO2_ratio: 0.945, // -5.5%
      },
      // CORRECTED: 400V systems use ~230V phase-neutral reference, not 400V
      '400V_MONO': {
        BO2_threshold: 218.5, // 95% of 230V (phase-neutral)
        BO1_threshold: 224.25, // 97.5% of 230V (phase-neutral)
        BYP_low: 224.25, // 97.5% of 230V (phase-neutral)
        BYP_high: 235.75, // 102.5% of 230V (phase-neutral)
        LO1_threshold: 235.75, // 102.5% of 230V (phase-neutral)
        LO2_threshold: 241.5, // 105% of 230V (phase-neutral)
        BO2_ratio: 1.055, // +5.5%
        BO1_ratio: 1.025, // +2.5%
        LO1_ratio: 0.975, // -2.5%
        LO2_ratio: 0.945, // -5.5%
      },
      '400V_POLY': {
        BO2_threshold: 218.5, // 95% of 230V (phase-neutral)
        BO1_threshold: 224.25, // 97.5% of 230V (phase-neutral)
        BYP_low: 224.25, // 97.5% of 230V (phase-neutral)
        BYP_high: 235.75, // 102.5% of 230V (phase-neutral)
        LO1_threshold: 235.75, // 102.5% of 230V (phase-neutral)
        LO2_threshold: 241.5, // 105% of 230V (phase-neutral)
        BO2_ratio: 1.055, // +5.5%
        BO1_ratio: 1.025, // +2.5%
        LO1_ratio: 0.975, // -2.5%
        LO2_ratio: 0.945, // -5.5%
      }
    };

    const selectedThresholds = thresholds[networkType] || thresholds['230V_POLY'];
    console.log(`[SRG2] Using thresholds for ${networkType}:`, selectedThresholds);
    return selectedThresholds;
  }
  
  /**
   * Calculate regulation state and ratio based on voltage and thresholds
   * CORRECTED: Use the ratios defined in thresholds structure
   */
  private calculateRegulation(voltage: number, thresholds: any): { state: string; ratio: number } {
    console.log(`[SRG2] Calculating regulation for voltage ${voltage}V with thresholds:`, thresholds);
    
    if (voltage <= thresholds.BO2_threshold) {
      console.log(`[SRG2] Voltage ${voltage}V <= BO2_threshold ${thresholds.BO2_threshold}V → BO2 state`);
      return { state: 'BO2', ratio: thresholds.BO2_ratio };
    } else if (voltage <= thresholds.BO1_threshold) {
      console.log(`[SRG2] Voltage ${voltage}V <= BO1_threshold ${thresholds.BO1_threshold}V → BO1 state`);
      return { state: 'BO1', ratio: thresholds.BO1_ratio };
    } else if (voltage >= thresholds.LO2_threshold) {
      console.log(`[SRG2] Voltage ${voltage}V >= LO2_threshold ${thresholds.LO2_threshold}V → LO2 state`);
      return { state: 'LO2', ratio: thresholds.LO2_ratio };
    } else if (voltage >= thresholds.LO1_threshold) {
      console.log(`[SRG2] Voltage ${voltage}V >= LO1_threshold ${thresholds.LO1_threshold}V → LO1 state`);
      return { state: 'LO1', ratio: thresholds.LO1_ratio };
    } else {
      console.log(`[SRG2] Voltage ${voltage}V in normal range → BYP state`);
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