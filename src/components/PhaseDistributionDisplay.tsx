import React from 'react';
import { Label } from "@/components/ui/label";
import { useNetworkStore } from "@/store/networkStore";

export const PhaseDistributionDisplay = () => {
  const { currentProject, calculationResults, selectedScenario } = useNetworkStore();
  
  if (!currentProject || currentProject.loadModel !== 'monophase_reparti' || !calculationResults[selectedScenario]) {
    return null;
  }

  // Calculer les répartitions selon le déséquilibre
  const d = Math.max(0, Math.min(1, (currentProject.desequilibrePourcent || 0) / 100));
  const pA = (1/3) + (d * 0.4);  // Phase A: 33,3% à 46,6%
  const pB = (1/3) - (d * 0.2);  // Phase B: 33,3% à 26,7%
  const pC = (1/3) - (d * 0.2);  // Phase C: 33,3% à 26,7%

  // Calculer les totaux des charges et productions
  const totalCharges = currentProject.nodes
    .filter(n => n.clients && n.clients.length > 0)
    .reduce((sum, n) => sum + (n.clients || []).reduce((s, c) => s + (c.S_kVA || 0), 0), 0) * (currentProject.foisonnementCharges / 100);

  const totalProductions = currentProject.nodes
    .filter(n => n.productions && n.productions.length > 0)
    .reduce((sum, n) => sum + (n.productions || []).reduce((s, p) => s + (p.S_kVA || 0), 0), 0) * (currentProject.foisonnementProductions / 100);

  // Répartition par phase
  const chargesA = totalCharges * pA;
  const chargesB = totalCharges * pB;
  const chargesC = totalCharges * pC;

  const productionsA = totalProductions * pA;
  const productionsB = totalProductions * pB;
  const productionsC = totalProductions * pC;

  return (
    <div className="text-xs text-primary-foreground/90 font-medium bg-white/5 px-3 py-1 rounded">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Label className="font-medium">Charges:</Label>
          <span>A: {chargesA.toFixed(1)}kVA</span>
          <span>B: {chargesB.toFixed(1)}kVA</span>
          <span>C: {chargesC.toFixed(1)}kVA</span>
        </div>
        {totalProductions > 0 && (
          <div className="flex items-center gap-2">
            <Label className="font-medium">Productions:</Label>
            <span>A: {productionsA.toFixed(1)}kVA</span>
            <span>B: {productionsB.toFixed(1)}kVA</span>
            <span>C: {productionsC.toFixed(1)}kVA</span>
          </div>
        )}
      </div>
    </div>
  );
};