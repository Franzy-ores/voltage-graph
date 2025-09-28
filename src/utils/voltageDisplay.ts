import { Node, Project, CalculationResult, SimulationResult } from '@/types/network';
import { getDisplayVoltage } from './voltageReference';

/**
 * Centralized voltage display utilities
 * Unifies logic for reading and displaying node voltages across components
 */

export interface VoltageInfo {
  voltage: number;
  isRegulated: boolean;
  phases?: { A: number; B: number; C: number };
  source: 'simulation' | 'calculation' | 'fallback';
}

/**
 * Get unified voltage information for a node
 * Handles all complexity of choosing between simulation/calculation results
 */
export function getNodeVoltageInfo(
  nodeId: string,
  project: Project,
  calculationResults: Record<string, CalculationResult | null>,
  simulationResults: Record<string, SimulationResult | null>,
  selectedScenario: string,
  simulationMode: boolean,
  simulationEquipment: any
): VoltageInfo {
  
  // Determine if we should use simulation results
  const activeEquipmentCount = (simulationEquipment.srg2?.enabled ? 1 : 0) + 
                              simulationEquipment.neutralCompensators.filter((c: any) => c.enabled).length;
  
  const useSimulation = simulationMode && activeEquipmentCount > 0;
  
  console.log('🔍 Voltage Info Logic:', {
    nodeId,
    simulationMode,
    activeEquipmentCount,
    useSimulation,
    selectedScenario,
    hasSimulationResults: !!simulationResults[selectedScenario],
    hasCalculationResults: !!calculationResults[selectedScenario]
  });
  
  // Try simulation results first if we should use them
  let result = null;
  let sourceType: 'simulation' | 'calculation' | 'fallback' = 'fallback';
  
  if (useSimulation && simulationResults[selectedScenario]) {
    result = simulationResults[selectedScenario];
    sourceType = 'simulation';
  } else if (calculationResults[selectedScenario]) {
    // Fallback to calculation results
    result = calculationResults[selectedScenario];
    sourceType = 'calculation';
  }
  
  if (!result) {
    console.log('🔍 No results found, using fallback voltage for:', nodeId);
    return getFallbackVoltage(nodeId, project);
  }
  
  // For monophase_reparti: try to get per-phase voltages
  if (project.loadModel === 'monophase_reparti' && result.nodeMetricsPerPhase) {
    const nodeMetrics = result.nodeMetricsPerPhase.find(nm => nm.nodeId === nodeId);
    if (nodeMetrics) {
      // Use calculatedVoltagesPerPhase if available (from SRG2), otherwise voltagesPerPhase
      const voltages = nodeMetrics.calculatedVoltagesPerPhase || nodeMetrics.voltagesPerPhase;
      
      // Calculate average voltage for display
      const avgVoltage = (voltages.A + voltages.B + voltages.C) / 3;
      
      return {
        voltage: avgVoltage,
        isRegulated: !!nodeMetrics.calculatedVoltagesPerPhase, // Regulated if calculated voltages exist
        phases: voltages,
        source: sourceType
      };
    }
  }
  
  // For polyphase_equilibre or fallback: use nodeMetrics
  if (result.nodeMetrics) {
    const nodeMetric = result.nodeMetrics.find(nm => nm.nodeId === nodeId);
    if (nodeMetric) {
      // For polyphase_equilibre with SRG2: check if we have SRG2 regulated voltage
      let voltage = nodeMetric.V_phase_V;
      let isRegulated = false;
      
      // If this is a simulation result with SRG2, use the regulated voltage
      if (sourceType === 'simulation' && result.srg2Result && result.srg2Result.nodeId === nodeId) {
        voltage = result.srg2Result.regulatedVoltage;
        isRegulated = result.srg2Result.isActive;
      } else {
        // For downstream nodes affected by SRG2, use the calculated voltages from solver
        // The solver should have already propagated the SRG2 effects via tensionCible pinning
        const node = project.nodes.find(n => n.id === nodeId);
        isRegulated = node && (node as any).srg2Applied;
      }
      
      return {
        voltage,
        isRegulated,
        source: sourceType
      };
    }
  }
  
  // Fallback
  return getFallbackVoltage(nodeId, project);
}

/**
 * Get fallback voltage when no calculation results are available
 */
function getFallbackVoltage(nodeId: string, project: Project): VoltageInfo {
  const node = project.nodes.find(n => n.id === nodeId);
  
  if (node?.isSource) {
    // Source node: use target voltage or system default
    const sourceVoltage = node.tensionCible || getDisplayVoltage(project.voltageSystem, project.loadModel);
    return {
      voltage: sourceVoltage,
      isRegulated: false,
      source: 'fallback'
    };
  }
  
  // Non-source node: use system reference
  const systemReference = getDisplayVoltage(project.voltageSystem, project.loadModel);
  return {
    voltage: systemReference,
    isRegulated: false,
    source: 'fallback'
  };
}

/**
 * Get voltage compliance color class
 */
export function getVoltageComplianceColor(voltage: number, project: Project): string {
  const reference = getDisplayVoltage(project.voltageSystem, project.loadModel);
  const deviation = Math.abs(voltage - reference) / reference;
  
  if (deviation > 0.10) {
    return 'text-red-600'; // >10% deviation
  } else if (deviation > 0.05) {
    return 'text-orange-500'; // 5-10% deviation
  } else {
    return 'text-green-600'; // <5% deviation
  }
}

/**
 * Get unified SRG2 voltage thresholds (all based on 230V reference)
 */
export function getSRG2VoltageThresholds() {
  return {
    BO2_max: 207,     // 230 * 0.90
    BO1_max: 218.5,   // 230 * 0.95
    BYP_min: 218.5,   // 230 * 0.95
    BYP_max: 241.5,   // 230 * 1.05
    LO1_min: 241.5,   // 230 * 1.05
    LO2_min: 253      // 230 * 1.10
  };
}

/**
 * Calculate SRG2 regulation state and corrected voltage based on input voltage
 */
export function calculateSRG2Regulation(voltage: number): { state: string; correctedVoltage: number } {
  const thresholds = getSRG2VoltageThresholds();
  
  if (voltage <= thresholds.BO2_max) {
    return { state: 'BO2', correctedVoltage: 248.4 }; // 230V * 1.08
  } else if (voltage <= thresholds.BO1_max) {
    return { state: 'BO1', correctedVoltage: 239.2 }; // 230V * 1.04
  } else if (voltage >= thresholds.LO2_min) {
    return { state: 'LO2', correctedVoltage: 211.6 }; // 230V * 0.92
  } else if (voltage >= thresholds.LO1_min) {
    return { state: 'LO1', correctedVoltage: 220.8 }; // 230V * 0.96
  } else {
    return { state: 'BYP', correctedVoltage: voltage };
  }
}