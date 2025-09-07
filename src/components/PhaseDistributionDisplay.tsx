import React from 'react';
import { Label } from "@/components/ui/label";
import { useNetworkStore } from "@/store/networkStore";

export const PhaseDistributionDisplay = () => {
  const { currentProject, calculationResults, selectedScenario } = useNetworkStore();
  
  if (!currentProject || currentProject.loadModel !== 'monophase_reparti' || !calculationResults[selectedScenario]) {
    return null;
  }

  // Utiliser les pourcentages de distribution manuelle configurés dans les sliders
  const distributeLoadsAndProductions = () => {
    const distributionTotals = { 
      charges: { A: 0, B: 0, C: 0 }, 
      productions: { A: 0, B: 0, C: 0 } 
    };
    
    // Calculer les totaux de charges et productions
    let totalCharges = 0;
    let totalProductions = 0;
    
    currentProject.nodes.forEach(node => {
      if (node.clients && node.clients.length > 0) {
        node.clients.forEach(client => {
          totalCharges += (client.S_kVA || 0) * (currentProject.foisonnementCharges / 100);
        });
      }
      
      if (node.productions && node.productions.length > 0) {
        node.productions.forEach(production => {
          totalProductions += (production.S_kVA || 0) * (currentProject.foisonnementProductions / 100);
        });
      }
    });
    
    // Appliquer les pourcentages de distribution manuelle
    if (currentProject.manualPhaseDistribution) {
      const chargesDist = currentProject.manualPhaseDistribution.charges;
      const productionsDist = currentProject.manualPhaseDistribution.productions;
      
      distributionTotals.charges.A = totalCharges * (chargesDist.A / 100);
      distributionTotals.charges.B = totalCharges * (chargesDist.B / 100);
      distributionTotals.charges.C = totalCharges * (chargesDist.C / 100);
      
      distributionTotals.productions.A = totalProductions * (productionsDist.A / 100);
      distributionTotals.productions.B = totalProductions * (productionsDist.B / 100);
      distributionTotals.productions.C = totalProductions * (productionsDist.C / 100);
    }
    
    return distributionTotals;
  };

  const { charges, productions } = distributeLoadsAndProductions();

  return (
    <div className="text-xs text-primary-foreground/90 font-medium bg-white/5 px-3 py-1 rounded">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Label className="font-medium">Charges:</Label>
          <span>A: {charges.A.toFixed(1)}kVA</span>
          <span>B: {charges.B.toFixed(1)}kVA</span>
          <span>C: {charges.C.toFixed(1)}kVA</span>
        </div>
        {(productions.A + productions.B + productions.C) > 0 && (
          <div className="flex items-center gap-2">
            <Label className="font-medium">Productions:</Label>
            <span>A: {productions.A.toFixed(1)}kVA</span>
            <span>B: {productions.B.toFixed(1)}kVA</span>
            <span>C: {productions.C.toFixed(1)}kVA</span>
          </div>
        )}
      </div>
    </div>
  );
};