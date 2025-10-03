import React from 'react';
import { useNetworkStore } from "@/store/networkStore";

interface NodePhaseDisplayProps {
  nodeId: string;
}

export const NodePhaseDisplay = ({ nodeId }: NodePhaseDisplayProps) => {
  const { calculationResults, simulationResults, selectedScenario, currentProject, simulationEquipment, isSimulationActive } = useNetworkStore();
  
  if (!currentProject || currentProject.loadModel !== 'monophase_reparti') {
    return null;
  }

  // Utiliser les résultats de simulation si active ET du matériel de simulation est actif
  const activeEquipmentCount = (simulationEquipment.srg2Devices?.filter(s => s.enabled).length || 0) + 
                               simulationEquipment.neutralCompensators.filter(c => c.enabled).length;
  
  const useSimulation = isSimulationActive && activeEquipmentCount > 0;
  const resultsToUse = useSimulation ? simulationResults : calculationResults;
  
  console.log('🐛 NodePhaseDisplay logic:', {
    isSimulationActive,
    activeEquipmentCount,
    useSimulation,
    resultsType: useSimulation ? 'simulation' : 'calculation'
  });
  
  if (!resultsToUse[selectedScenario]?.nodeMetricsPerPhase) {
    return null;
  }

  const nodeMetrics = resultsToUse[selectedScenario]!.nodeMetricsPerPhase!
    .find(nm => nm.nodeId === nodeId);
    
  if (!nodeMetrics) {
    return null;
  }

  const { voltagesPerPhase, voltageDropsPerPhase } = nodeMetrics;

  return (
    <div className="text-xs bg-background/90 border rounded px-2 py-1 space-y-1">
      <div className="font-medium text-foreground">Tensions par phase:</div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="text-center">
          <div className="font-medium text-blue-600">Phase A</div>
          <div>{voltagesPerPhase.A.toFixed(1)}V</div>
          <div className="text-muted-foreground">ΔU: {voltageDropsPerPhase.A.toFixed(1)}V</div>
        </div>
        <div className="text-center">
          <div className="font-medium text-green-600">Phase B</div>
          <div>{voltagesPerPhase.B.toFixed(1)}V</div>
          <div className="text-muted-foreground">ΔU: {voltageDropsPerPhase.B.toFixed(1)}V</div>
        </div>
        <div className="text-center">
          <div className="font-medium text-red-600">Phase C</div>
          <div>{voltagesPerPhase.C.toFixed(1)}V</div>
          <div className="text-muted-foreground">ΔU: {voltageDropsPerPhase.C.toFixed(1)}V</div>
        </div>
      </div>
    </div>
  );
};