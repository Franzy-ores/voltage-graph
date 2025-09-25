import React from 'react';
import { UnifiedVoltageDisplay } from './UnifiedVoltageDisplay';

interface NodePhaseDisplayProps {
  nodeId: string;
}

export const NodePhaseDisplay = ({ nodeId }: NodePhaseDisplayProps) => {
  return (
    <UnifiedVoltageDisplay
      nodeId={nodeId}
      displayType="phases"
      showRegulationIndicator={true}
      showComplianceColor={true}
    />
  );
};