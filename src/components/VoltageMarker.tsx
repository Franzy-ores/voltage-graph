import React from 'react';
import { useNetworkStore } from "@/store/networkStore";
import { Node } from '@/types/network';

interface VoltageMarkerProps {
  node: Node;
}

export const VoltageMarker = ({ node }: VoltageMarkerProps) => {
  const { 
    calculationResults, 
    simulationResults, 
    selectedScenario, 
    currentProject, 
    simulationEquipment, 
    simulationMode 
  } = useNetworkStore();
  
  if (!currentProject) return null;

  // Determine which results to use based on simulation mode and active equipment
  const activeEquipmentCount = (simulationEquipment.srg2?.enabled ? 1 : 0) + 
                               simulationEquipment.neutralCompensators.filter(c => c.enabled).length;
  
  const resultsToUse = (simulationMode && activeEquipmentCount > 0) ? simulationResults : calculationResults;
  const currentResult = resultsToUse[selectedScenario];
  
  if (!currentResult) return null;

  // Get voltage information for this node
  const getVoltageInfo = () => {
    // For per-phase calculations (monophase_reparti)
    if (currentResult.nodeMetricsPerPhase) {
      const nodeMetrics = currentResult.nodeMetricsPerPhase.find(nm => nm.nodeId === node.id);
      if (nodeMetrics) {
        // Use calculatedVoltagesPerPhase if available (from SRG2), otherwise voltagesPerPhase
        const voltages = nodeMetrics.calculatedVoltagesPerPhase || nodeMetrics.voltagesPerPhase;
        
        // For display, show the phase A voltage as primary
        return {
          voltage: voltages.A,
          isRegulated: !!nodeMetrics.calculatedVoltagesPerPhase,
          phases: voltages
        };
      }
    }
    
    // For single-phase calculations (polyphase_equilibre)
    if (currentResult.nodeMetrics) {
      const nodeMetric = currentResult.nodeMetrics.find(nm => nm.nodeId === node.id);
      if (nodeMetric) {
        return {
          voltage: nodeMetric.V_phase_V,
          isRegulated: false,
          phases: null
        };
      }
    }
    
    // Fallback to source voltage
    if (node.isSource) {
      const sourceVoltage = currentProject.voltageSystem === 'TRIPHASÉ_230V' ? 230 : 400;
      return {
        voltage: node.tensionCible || sourceVoltage,
        isRegulated: false,
        phases: null
      };
    }
    
    return null;
  };

  const voltageInfo = getVoltageInfo();
  if (!voltageInfo) return null;

  // Determine voltage compliance color
  const getVoltageColor = (voltage: number) => {
    const nominalVoltage = currentProject.voltageSystem === 'TRIPHASÉ_230V' ? 230 : 400;
    const deviationPercent = Math.abs((voltage - nominalVoltage) / nominalVoltage * 100);
    
    if (deviationPercent > 10) return 'text-red-600'; // Critical
    if (deviationPercent > 8) return 'text-orange-500'; // Warning
    return 'text-green-600'; // Normal
  };

  const displayVoltage = currentProject.loadModel === 'monophase_reparti' && 
                        currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' ? 
                        voltageInfo.voltage : // Phase-neutral for 400V monophase
                        voltageInfo.voltage;  // Direct voltage for other cases

  return (
    <div className="absolute -top-6 -right-2 text-xs font-medium z-10">
      <div className={`bg-background/90 border rounded px-1 py-0.5 ${getVoltageColor(displayVoltage)}`}>
        {displayVoltage.toFixed(0)}V
        {voltageInfo.isRegulated && (
          <span className="ml-1 text-blue-600 font-bold">*</span>
        )}
      </div>
      {/* SRG2 regulation indicator */}
      {simulationEquipment.srg2?.nodeId === node.id && simulationEquipment.srg2.enabled && (
        <div className="text-center mt-1">
          <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
        </div>
      )}
    </div>
  );
};