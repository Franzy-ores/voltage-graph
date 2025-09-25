import { VoltageSystem, LoadModel } from '@/types/network';

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