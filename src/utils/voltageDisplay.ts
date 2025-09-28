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
      
      // ✅ FIXED: Check if this node is the SRG2 node using simulationEquipment directly
      const isSrg2Node = simulationEquipment.srg2?.enabled && simulationEquipment.srg2?.nodeId === nodeId;
      
      if (isSrg2Node && sourceType === 'simulation') {
        // For SRG2 node in simulation mode, check if we have SRG2 result
        if (result.srg2Result && result.srg2Result.nodeId === nodeId) {
          // ✅ CRITICAL FIX: Always show SRG2 indicator if srg2Result exists for this node
          voltage = result.srg2Result.regulatedVoltage || nodeMetric.V_phase_V;
          isRegulated = true; // Always show the * for SRG2 nodes when configured
        } else {
          // Fallback: Check if the node has SRG2 properties applied
          const node = project.nodes.find(n => n.id === nodeId);
          if (node && ((node as any).srg2Applied || node.tensionCible)) {
            voltage = nodeMetric.V_phase_V;
            isRegulated = true;
          }
        }
      } else {
        // For downstream nodes affected by SRG2, use the calculated voltages from solver
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
 * Calculate SRG2 regulation state and ratio
 */
export function calculateSRG2Regulation(voltage: number): { state: string; ratio: number } {
  const thresholds = getSRG2VoltageThresholds();
  
  if (voltage <= thresholds.BO2_max) {
    return { state: 'BO2', ratio: 1.10 };
  } else if (voltage <= thresholds.BO1_max) {
    return { state: 'BO1', ratio: 1.05 };
  } else if (voltage >= thresholds.LO2_min) {
    return { state: 'LO2', ratio: 0.90 };
  } else if (voltage >= thresholds.LO1_min) {
    return { state: 'LO1', ratio: 0.95 };
  } else {
    return { state: 'BYP', ratio: 1.00 };
  }
}