import React from 'react';
import { useNetworkStore } from '@/store/networkStore';
import { getNodeVoltageInfo, getVoltageComplianceColor } from '@/utils/voltageDisplay';

/**
 * Unified voltage display component
 * Centralizes all voltage display logic from VoltageMarker, NodePhaseDisplay, and MapView
 */

interface UnifiedVoltageDisplayProps {
  nodeId: string;
  displayType?: 'marker' | 'phases' | 'detailed';
  showRegulationIndicator?: boolean;
  showComplianceColor?: boolean;
}

export const UnifiedVoltageDisplay = ({ 
  nodeId, 
  displayType = 'marker',
  showRegulationIndicator = true,
  showComplianceColor = true
}: UnifiedVoltageDisplayProps) => {
  const { 
    currentProject, 
    calculationResults, 
    simulationResults, 
    selectedScenario, 
    simulationMode, 
    simulationEquipment 
  } = useNetworkStore();

  if (!currentProject) return null;

  const voltageInfo = getNodeVoltageInfo(
    nodeId,
    currentProject,
    calculationResults,
    simulationResults,
    selectedScenario,
    simulationMode,
    simulationEquipment
  );

  const complianceColor = showComplianceColor 
    ? getVoltageComplianceColor(voltageInfo.voltage, currentProject)
    : 'text-foreground';

  // Check if node has active SRG2
  const hasActiveSRG2 = simulationEquipment.srg2?.enabled && 
                       simulationEquipment.srg2?.nodeId === nodeId;

  if (displayType === 'phases' && currentProject.loadModel === 'monophase_reparti' && voltageInfo.phases) {
    return (
      <div className="text-xs bg-background/90 border rounded px-2 py-1 space-y-1">
        <div className="font-medium text-foreground">Tensions par phase:</div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="text-center">
            <div className="font-medium text-blue-600">Phase A</div>
            <div className={complianceColor}>
              {voltageInfo.phases.A.toFixed(1)}V
              {voltageInfo.isRegulated && showRegulationIndicator && '*'}
            </div>
          </div>
          <div className="text-center">
            <div className="font-medium text-green-600">Phase B</div>
            <div className={complianceColor}>
              {voltageInfo.phases.B.toFixed(1)}V
              {voltageInfo.isRegulated && showRegulationIndicator && '*'}
            </div>
          </div>
          <div className="text-center">
            <div className="font-medium text-red-600">Phase C</div>
            <div className={complianceColor}>
              {voltageInfo.phases.C.toFixed(1)}V
              {voltageInfo.isRegulated && showRegulationIndicator && '*'}
            </div>
          </div>
        </div>
        {voltageInfo.isRegulated && (
          <div className="text-xs text-muted-foreground text-center">
            * Tension régulée par SRG2
          </div>
        )}
      </div>
    );
  }

  if (displayType === 'detailed') {
    return (
      <div className="space-y-1">
        <div className={`font-medium ${complianceColor}`}>
          {voltageInfo.voltage.toFixed(1)}V
          {voltageInfo.isRegulated && showRegulationIndicator && ' *'}
        </div>
        {hasActiveSRG2 && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <span className="text-xs text-blue-600">SRG2 Actif</span>
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          Source: {voltageInfo.source}
        </div>
      </div>
    );
  }

  // Default marker display
  return (
    <span className={`text-xs font-medium ${complianceColor}`}>
      {voltageInfo.voltage.toFixed(1)}V
      {voltageInfo.isRegulated && showRegulationIndicator && '*'}
      {hasActiveSRG2 && (
        <span className="ml-1">
          <div className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
        </span>
      )}
    </span>
  );
};