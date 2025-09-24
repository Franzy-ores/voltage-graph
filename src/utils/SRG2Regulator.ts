import { SRG2Config, SRG2Result, Project, CalculationResult, Node } from '@/types/network';

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
    
    // Derive network type from project voltage system
    const networkType = project.voltageSystem === 'TRIPHASÉ_230V' ? '230V' : '400V';
    const thresholds = this.getVoltageThresholds(networkType);
    
    // Determine regulation state based on voltage
    const { state, ratio } = this.calculateRegulation(originalVoltage, thresholds);
    
    const regulatedVoltage = originalVoltage * ratio;
    const isActive = state !== 'BYP' && ratio !== 1.0;
    
    console.log(`📊 SRG2 Result - State: ${state}, Ratio: ${ratio.toFixed(3)}, Active: ${isActive}`);
    
    return {
      nodeId: config.nodeId,
      state,
      ratio,
      isActive,
      originalVoltage,
      regulatedVoltage,
      powerDownstream_kVA: 0, // TODO: Calculate based on downstream analysis
      regulatedVoltages: {
        A: regulatedVoltage,
        B: regulatedVoltage, 
        C: regulatedVoltage
      },
      phaseRatios: {
        A: ratio,
        B: ratio,
        C: ratio
      },
      diversifiedLoad_kVA: 0, // Simplified - would need downstream calculation
      diversifiedProduction_kVA: 0,
      netPower_kVA: 0,
      networkType
    };
  }
  
  /**
   * Get voltage thresholds for different network types
   */
  private getVoltageThresholds(networkType: string) {
    if (networkType === '230V') {
      return {
        // 230V system thresholds
        BO2_threshold: 210,  // Strong boost needed
        BO1_threshold: 220,  // Light boost needed  
        BYP_low: 225,        // Normal range low
        BYP_high: 235,       // Normal range high
        LO1_threshold: 240,  // Light reduction needed
        LO2_threshold: 250   // Strong reduction needed
      };
    } else {
      return {
        // 400V system thresholds (phase-neutral ~230V)
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
   * Reset internal state (for multi-iteration calculations)
   */
  reset(): void {
    // Nothing to reset in this simplified implementation
    console.log('🔄 SRG2 Regulator reset');
  }
}