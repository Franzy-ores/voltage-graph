import React from 'react';
import { Label } from "@/components/ui/label";
import { useNetworkStore } from "@/store/networkStore";

export const PhaseDistributionDisplay = () => {
  const { currentProject, calculationResults, selectedScenario } = useNetworkStore();
  
  if (!currentProject || currentProject.loadModel !== 'monophase_reparti' || !calculationResults[selectedScenario]) {
    return null;
  }

  // Utiliser la même logique de distribution dynamique que SimulationCalculator
  const distributeLoadsAndProductions = () => {
    const distributionTotals = { 
      charges: { A: 0, B: 0, C: 0 }, 
      productions: { A: 0, B: 0, C: 0 } 
    };
    
    currentProject.nodes.forEach(node => {
      // Répartir les charges de manière aléatoire (simulation de la distribution)
      if (node.clients && node.clients.length > 0) {
        const phases = ['A', 'B', 'C'] as const;
        node.clients.forEach(client => {
          const randomPhase = phases[Math.floor(Math.random() * 3)];
          const power = (client.S_kVA || 0) * (currentProject.foisonnementCharges / 100);
          distributionTotals.charges[randomPhase] += power;
        });
      }
      
      // Répartir les productions selon la règle ≤5kVA = mono, >5kVA = tri
      if (node.productions && node.productions.length > 0) {
        const phases = ['A', 'B', 'C'] as const;
        node.productions.forEach(production => {
          const power = (production.S_kVA || 0) * (currentProject.foisonnementProductions / 100);
          if (power <= 5) {
            // Monophasé - assigner à une phase aléatoire
            const randomPhase = phases[Math.floor(Math.random() * 3)];
            distributionTotals.productions[randomPhase] += power;
          } else {
            // Triphasé - répartir équitablement sur les trois phases
            const powerPerPhase = power / 3;
            distributionTotals.productions.A += powerPerPhase;
            distributionTotals.productions.B += powerPerPhase;
            distributionTotals.productions.C += powerPerPhase;
          }
        });
      }
    });
    
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