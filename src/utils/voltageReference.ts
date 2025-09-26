import { VoltageSystem, LoadModel, CalculationResult, Project } from '@/types/network';

/**
 * Centralized voltage reference system
 * Maps voltage systems and load models to their actual reference voltages
 */

export interface VoltageReference {
  nominal: number;        // Nominal voltage value
  phaseToNeutral: number; // Phase-to-neutral voltage
  phaseToPhase: number;   // Phase-to-phase voltage
  displayReference: number; // Reference voltage for regulation thresholds and display
}

/**
 * Get the correct voltage reference based on voltage system and load model
 */
export function getNetworkVoltageReference(
  voltageSystem: VoltageSystem, 
  loadModel: LoadModel
): VoltageReference {
  switch (voltageSystem) {
    case 'TRIPHASÉ_230V':
      if (loadModel === 'monophase_reparti') {
        // Monophase distributed: phase-to-phase = 230V
        return {
          nominal: 230,
          phaseToNeutral: 133, // 230/√3
          phaseToPhase: 230,
          displayReference: 230
        };
      } else {
        // Balanced polyphase: line voltage = 230V
        return {
          nominal: 230,
          phaseToNeutral: 133, // 230/√3  
          phaseToPhase: 230,
          displayReference: 230
        };
      }
      
    case 'TÉTRAPHASÉ_400V':
      if (loadModel === 'monophase_reparti') {
        // Monophase distributed: phase-to-neutral = 230V
        return {
          nominal: 400,
          phaseToNeutral: 230, // 400/√3
          phaseToPhase: 400,
          displayReference: 230 // SRG2 regulates phase-to-neutral
        };
      } else {
        // Balanced polyphase: phase-to-neutral = 230V
        return {
          nominal: 400,
          phaseToNeutral: 230, // 400/√3
          phaseToPhase: 400,
          displayReference: 230 // SRG2 regulates phase-to-neutral
        };
      }
      
    default:
      // Fallback to TÉTRAPHASÉ_400V
      return {
        nominal: 400,
        phaseToNeutral: 230,
        phaseToPhase: 400,
        displayReference: 230
      };
  }
}

/**
 * Get the display voltage for a node based on network configuration
 * This determines which voltage value to show in displays and use for thresholds
 */
export function getDisplayVoltage(
  voltageSystem: VoltageSystem,
  loadModel: LoadModel
): number {
  const ref = getNetworkVoltageReference(voltageSystem, loadModel);
  return ref.displayReference;
}

/**
 * Get SRG2 reference voltage from calculation results
 * SRG2 always works with phase-neutral voltage (230V), regardless of network type
 */
export function getSRG2ReferenceVoltage(
  nodeId: string,
  calculationResult: CalculationResult,
  project: Project
): number {
  const voltageRef = getNetworkVoltageReference(project.voltageSystem, project.loadModel || 'polyphase_equilibre');
  const srg2TargetVoltage = 230; // SRG2 always works with 230V phase-neutral
  
  // Try to read the actual calculated voltage first
  let calculatedVoltage: number | null = null;
  
  if (project.loadModel === 'polyphase_equilibre') {
    // For balanced polyphase, read from nodeMetrics
    const nodeMetric = calculationResult.nodeMetrics?.find(n => n.nodeId === nodeId);
    if (nodeMetric) {
      calculatedVoltage = nodeMetric.V_phase_V;
      
      // Convert to phase-neutral if needed
      if (project.voltageSystem === 'TRIPHASÉ_230V') {
        // For 230V triphasé, V_phase_V is already phase-neutral voltage (no conversion needed)
        // No conversion needed - calculatedVoltage is already the phase-neutral value
      } else if (project.voltageSystem === 'TÉTRAPHASÉ_400V') {
        // For 400V tétra, V_phase_V should already be phase-neutral (230V)
        // No conversion needed
      }
    }
  } else {
    // For unbalanced systems, read from nodeMetricsPerPhase
    const nodeMetric = calculationResult.nodeMetricsPerPhase?.find(n => n.nodeId === nodeId);
    if (nodeMetric && nodeMetric.voltagesPerPhase) {
      // Use phase A as reference
      calculatedVoltage = nodeMetric.voltagesPerPhase.A;
      
      // Ensure it's phase-neutral voltage
      if (project.voltageSystem === 'TRIPHASÉ_230V') {
        // For 230V triphasé, phase voltages are already in correct reference for SRG2
        // No conversion needed - calculatedVoltage is already usable
      }
      // For TÉTRAPHASÉ_400V, phase voltages should already be phase-neutral (~230V)
    }
  }
  
  // If we have a calculated voltage, use it directly for SRG2
  if (calculatedVoltage !== null && isFinite(calculatedVoltage) && calculatedVoltage > 0) {
    // For SRG2, use the calculated voltage directly (it's already in the correct reference)
    // No scaling needed - SRG2 thresholds are based on actual measured voltages
    
    console.log(`🎯 SRG2 voltage reading for node ${nodeId}:`);
    console.log(`   - Calculated voltage: ${calculatedVoltage.toFixed(1)}V`);
    console.log(`   - Network: ${project.voltageSystem}, Load Model: ${project.loadModel || 'polyphase_equilibre'}`);
    
    return calculatedVoltage;
  }
  
  // Fallback: always use SRG2's 230V phase-neutral reference
  console.log(`⚠️ SRG2 fallback: No calculated voltage found for node ${nodeId}, using 230V reference`);
  return srg2TargetVoltage;
}

/**
 * Check if voltage is within acceptable range (±10% of reference)
 */
export function isVoltageInRange(
  voltage: number,
  voltageSystem: VoltageSystem,
  loadModel: LoadModel
): boolean {
  const reference = getDisplayVoltage(voltageSystem, loadModel);
  const tolerance = 0.10; // ±10%
  const minVoltage = reference * (1 - tolerance);
  const maxVoltage = reference * (1 + tolerance);
  
  return voltage >= minVoltage && voltage <= maxVoltage;
}