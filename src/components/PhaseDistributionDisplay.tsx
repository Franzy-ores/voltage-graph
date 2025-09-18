import React from 'react';
import { Label } from "@/components/ui/label";
import { useNetworkStore } from "@/store/networkStore";

export const PhaseDistributionDisplay = () => {
  const { currentProject } = useNetworkStore();
  
  // Ne plus afficher les valeurs kVA ici car elles sont maintenant dans les sliders
  if (!currentProject || currentProject.loadModel !== 'monophase_reparti') {
    return null;
  }

  // Composant masqué, les valeurs kVA sont maintenant intégrées dans PhaseDistributionSliders
  return null;
};