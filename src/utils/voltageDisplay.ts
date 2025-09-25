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
  const resultsToUse = useSimulation ? simulationResults : calculationResults;
  const sourceType = useSimulation ? 'simulation' : 'calculation';
  
  console.log('🔍 Voltage Info Logic:', {
    nodeId,
    simulationMode,
    activeEquipmentCount,
    useSimulation,
    sourceType,
    selectedScenario,
    hasResults: !!resultsToUse[selectedScenario]
  });
  
  const result = resultsToUse[selectedScenario];
  if (!result) {
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
      // Check if this node has SRG2 regulation applied
      const node = project.nodes.find(n => n.id === nodeId);
      const hasRegulation = node && (node as any).srg2Applied;
      
      return {
        voltage: nodeMetric.V_phase_V, // Use correct property name
        isRegulated: !!hasRegulation,
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