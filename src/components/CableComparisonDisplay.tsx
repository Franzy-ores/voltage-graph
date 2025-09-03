import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNetworkStore } from "@/store/networkStore";
import { CalculationResult, SimulationResult } from "@/types/network";
import { TrendingUp, TrendingDown } from "lucide-react";

export const CableComparisonDisplay = () => {
  const { currentProject, simulationResults, selectedScenario } = useNetworkStore();
  
  if (!currentProject) return null;
  
  const currentResult = simulationResults[selectedScenario] as SimulationResult | null;
  if (!currentResult?.baselineResult) return null;
  
  const baselineResult = currentResult.baselineResult;
  const simulationResult = currentResult;
  
  // Comparer les tensions des nœuds
  const getNodeComparison = () => {
    if (!baselineResult.nodeMetrics || !simulationResult.nodeMetrics) return [];
    
    return currentProject.nodes
      .filter(node => !node.isSource)
      .map(node => {
        const baselineMetric = baselineResult.nodeMetrics?.find(m => m.nodeId === node.id);
        const simulationMetric = simulationResult.nodeMetrics?.find(m => m.nodeId === node.id);
        
        if (!baselineMetric || !simulationMetric) return null;
        
        // Calculer la tension ligne pour l'affichage
        const getLineVoltage = (phaseVoltage: number, connectionType: string) => {
          switch (connectionType) {
            case 'MONO_230V_PN':
            case 'MONO_230V_PP':
              return phaseVoltage;
            case 'TRI_230V_3F':
            case 'TÉTRA_3P+N_230_400V':
            default:
              return phaseVoltage * Math.sqrt(3);
          }
        };
        
        const baselineVoltage = getLineVoltage(baselineMetric.V_phase_V, node.connectionType || 'TÉTRA_3P+N_230_400V');
        const simulationVoltage = getLineVoltage(simulationMetric.V_phase_V, node.connectionType || 'TÉTRA_3P+N_230_400V');
        const voltageDifference = simulationVoltage - baselineVoltage;
        const percentageChange = (voltageDifference / baselineVoltage) * 100;
        
        // Calculer les chutes de tension
        const nominalVoltage = currentProject.voltageSystem === 'TRIPHASÉ_230V' ? 230 : 400;
        const baselineDropPercent = Math.abs((nominalVoltage - baselineVoltage) / nominalVoltage * 100);
        const simulationDropPercent = Math.abs((nominalVoltage - simulationVoltage) / nominalVoltage * 100);
        const dropImprovement = baselineDropPercent - simulationDropPercent;
        
        return {
          nodeId: node.id,
          nodeName: node.name,
          baselineVoltage,
          simulationVoltage,
          voltageDifference,
          percentageChange,
          baselineDropPercent,
          simulationDropPercent,
          dropImprovement
        };
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(b!.voltageDifference) - Math.abs(a!.voltageDifference));
  };
  
  const nodeComparisons = getNodeComparison();
  
  // Statistiques globales de comparaison
  const getGlobalComparison = () => {
    const baselineMaxDrop = baselineResult.maxVoltageDropPercent;
    const simulationMaxDrop = simulationResult.maxVoltageDropPercent;
    const maxDropImprovement = baselineMaxDrop - simulationMaxDrop;
    
    const baselineLosses = baselineResult.globalLosses_kW;
    const simulationLosses = simulationResult.globalLosses_kW;
    const lossReduction = baselineLosses - simulationLosses;
    
    return {
      maxDropImprovement,
      lossReduction,
      baselineMaxDrop,
      simulationMaxDrop,
      baselineLosses,
      simulationLosses
    };
  };
  
  const globalComparison = getGlobalComparison();
  
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-600" />
            Comparaison Amélioration Câbles
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Résumé global */}
          <div className="grid grid-cols-2 gap-4 p-3 bg-muted/50 rounded-lg">
            <div className="text-center">
              <div className="text-sm font-medium">Chute max. améliorée</div>
              <div className="text-lg font-bold text-green-600">
                -{globalComparison.maxDropImprovement.toFixed(3)}%
              </div>
              <div className="text-xs text-muted-foreground">
                {globalComparison.baselineMaxDrop.toFixed(2)}% → {globalComparison.simulationMaxDrop.toFixed(2)}%
              </div>
            </div>
            <div className="text-center">
              <div className="text-sm font-medium">Pertes réduites</div>
              <div className="text-lg font-bold text-green-600">
                -{globalComparison.lossReduction.toFixed(3)} kW
              </div>
              <div className="text-xs text-muted-foreground">
                {globalComparison.baselineLosses.toFixed(3)} → {globalComparison.simulationLosses.toFixed(3)} kW
              </div>
            </div>
          </div>
          
          {/* Tableau de comparaison des nœuds */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Comparaison des tensions par nœud :</div>
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="w-20">Nœud</TableHead>
                    <TableHead className="w-16">Avant (V)</TableHead>
                    <TableHead className="w-16">Après (V)</TableHead>
                    <TableHead className="w-16">Δ (V)</TableHead>
                    <TableHead className="w-16">Δ (%)</TableHead>
                    <TableHead className="w-20">Amélioration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodeComparisons.length > 0 ? (
                    nodeComparisons.map((comparison, index) => (
                      <TableRow key={comparison.nodeId} className="text-xs">
                        <TableCell className="font-medium">
                          {comparison.nodeName || `N${index + 1}`}
                        </TableCell>
                        <TableCell>{comparison.baselineVoltage.toFixed(1)}</TableCell>
                        <TableCell>{comparison.simulationVoltage.toFixed(1)}</TableCell>
                        <TableCell>
                          <div className={`flex items-center gap-1 ${
                            comparison.voltageDifference > 0 ? 'text-green-600' : 
                            comparison.voltageDifference < 0 ? 'text-red-600' : 'text-muted-foreground'
                          }`}>
                            {comparison.voltageDifference > 0 && <TrendingUp className="h-3 w-3" />}
                            {comparison.voltageDifference < 0 && <TrendingDown className="h-3 w-3" />}
                            {comparison.voltageDifference >= 0 ? '+' : ''}{comparison.voltageDifference.toFixed(2)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={`${
                            comparison.percentageChange > 0 ? 'text-green-600' : 
                            comparison.percentageChange < 0 ? 'text-red-600' : 'text-muted-foreground'
                          }`}>
                            {comparison.percentageChange >= 0 ? '+' : ''}{comparison.percentageChange.toFixed(2)}%
                          </div>
                        </TableCell>
                        <TableCell>
                          {comparison.dropImprovement > 0 ? (
                            <Badge variant="default" className="text-xs">
                              -{comparison.dropImprovement.toFixed(2)}% ΔU
                            </Badge>
                          ) : comparison.dropImprovement < 0 ? (
                            <Badge variant="destructive" className="text-xs">
                              +{Math.abs(comparison.dropImprovement).toFixed(2)}% ΔU
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              =
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-4">
                        Aucune différence détectable
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          
          {/* Informations complémentaires */}
          <div className="text-xs text-muted-foreground space-y-1">
            <div>• Les valeurs positives (↗) indiquent une amélioration de tension</div>
            <div>• Les améliorations de chute de tension (ΔU) sont en points de pourcentage</div>
            <div>• Les nœuds sont triés par ordre décroissant d'impact</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};