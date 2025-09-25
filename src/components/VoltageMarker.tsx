import React from 'react';
import { Node } from '@/types/network';
import { UnifiedVoltageDisplay } from './UnifiedVoltageDisplay';

/**
 * Updated VoltageMarker using unified display logic
 */

interface VoltageMarkerProps {
  node: Node;
}

export const VoltageMarker = ({ node }: VoltageMarkerProps) => {
  return (
    <div className="absolute -top-6 -right-2 text-xs font-medium z-10">
      <div className="bg-background/90 border rounded px-1 py-0.5">
        <UnifiedVoltageDisplay 
          nodeId={node.id}
          displayType="marker"
          showRegulationIndicator={true}
          showComplianceColor={true}
        />
      </div>
    </div>
  );
};