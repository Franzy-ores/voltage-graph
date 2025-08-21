import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalculationResult, CalculationScenario } from "@/types/network";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNetworkStore } from "@/store/networkStore";

interface ResultsPanelProps {
  results: {
    [key in CalculationScenario]: CalculationResult | null;
  };
  selectedScenario: CalculationScenario;
}

export const ResultsPanel = ({ results, selectedScenario }: ResultsPanelProps) => {
  const { currentProject } = useNetworkStore();
  
  // Calculer les statistiques des câbles
  const getCableStatistics = () => {
    if (!currentProject?.cables) return { totalLength: 0, lengthByType: {} };
    
    let totalLength = 0;
    const lengthByType: Record<string, number> = {};
    
    currentProject.cables.forEach(cable => {
      const length = cable.length_m || 0;
      totalLength += length;
      
      const cableType = currentProject.cableTypes.find(ct => ct.id === cable.typeId);
      const typeName = cableType?.label || cable.typeId;
      
      if (!lengthByType[typeName]) {
        lengthByType[typeName] = 0;
      }
      lengthByType[typeName] += length;
    });
    
    return { totalLength, lengthByType };
  };
  
  const cableStats = getCableStatistics();
  
  // Add safety checks
  if (!results || !selectedScenario) {
    return (
      <div className="w-80 bg-card border-l border-border p-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Résultats</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-center py-8">
              Chargement...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  const currentResult = results[selectedScenario];

  const getComplianceBadge = (compliance: 'normal' | 'warning' | 'critical') => {
    const variants = {
      normal: 'default',
      warning: 'warning', 
      critical: 'critical'
    } as const;

    const texts = {
      normal: 'Conforme EN 50160',
      warning: 'Attention ±8-10%',
      critical: 'Non conforme >±10%'
    };

    return (
      <Badge variant={variants[compliance]} className="text-xs">
        {texts[compliance]}
      </Badge>
    );
  };

  const formatScenarioName = (scenario: CalculationScenario) => {
    const names = {
      'PRÉLÈVEMENT': 'Prélèvement seul',
      'MIXTE': 'Mixte (Prélèvement + Production)',
      'PRODUCTION': 'Production seule'
    };
    return names[scenario];
  };

  if (!currentResult) {
    return (
      <div className="w-80 bg-card border-l border-border p-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Résultats</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-center py-8">
              Aucun calcul disponible.<br />
              Ajoutez des nœuds et câbles pour commencer.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-80 bg-card border-l border-border overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Global Summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center justify-between">
              Résumé Global
              {getComplianceBadge(currentResult.compliance)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Charge contractuelle</p>
                <p className="font-semibold">{(currentProject?.nodes.reduce((sum, node) => 
                  sum + node.clients.reduce((clientSum, client) => clientSum + client.S_kVA, 0), 0) || 0).toFixed(1)} kVA</p>
              </div>
              <div>
                <p className="text-muted-foreground">Foisonnement charges</p>
                <p className="font-semibold">{currentProject?.foisonnementCharges || 100}%</p>
              </div>
              <div>
                <p className="text-muted-foreground">Charge foisonnée</p>
                <p className="font-semibold">{currentResult.totalLoads_kVA.toFixed(1)} kVA</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-muted-foreground">Productions totales</p>
                  <p className="font-semibold">{currentResult.totalProductions_kVA.toFixed(1)} kVA</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pertes globales</p>
                  <p className="font-semibold">{currentResult.globalLosses_kW.toFixed(3)} kW</p>
                </div>
              </div>
              <div>
                <p className="text-muted-foreground">Chute max.</p>
                <p className="font-semibold">{currentResult.maxVoltageDropPercent.toFixed(2)}%</p>
              </div>
            </div>
            
            {/* Statistiques des câbles */}
            <div className="pt-3 border-t">
              <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                <div>
                  <p className="text-muted-foreground">Longueur totale</p>
                  <p className="font-semibold">{cableStats.totalLength.toFixed(0)} m</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Nombre de câbles</p>
                  <p className="font-semibold">{currentProject?.cables?.length || 0}</p>
                </div>
              </div>
              
              {/* Détail par type de câble */}
              {Object.keys(cableStats.lengthByType).length > 0 && (
                <div>
                  <p className="text-muted-foreground text-xs mb-2">Longueur par type :</p>
                  <div className="space-y-1">
                    {Object.entries(cableStats.lengthByType).map(([type, length]) => (
                      <div key={type} className="flex justify-between text-xs">
                        <span className="truncate pr-2">{type}</span>
                        <span className="font-medium">{length.toFixed(0)} m</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Scenario Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Scénario Actuel</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{formatScenarioName(selectedScenario)}</p>
          </CardContent>
        </Card>

        {/* All Scenarios Comparison */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Comparaison des Scénarios</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-xs">
              {(['PRÉLÈVEMENT', 'MIXTE', 'PRODUCTION'] as CalculationScenario[]).map(scenario => {
                const result = results[scenario];
                return (
                  <div key={scenario} className={`p-2 rounded border ${
                    scenario === selectedScenario ? 'border-primary bg-primary/5' : 'border-border'
                  }`}>
                    <p className="font-medium mb-1">{formatScenarioName(scenario)}</p>
                    {result ? (
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <span>Chute max: {result.maxVoltageDropPercent.toFixed(2)}%</span>
                        <span>Pertes: {result.globalLosses_kW.toFixed(3)} kW</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Non calculé</span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Cables Details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Détails par Tronçon</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {currentResult.cables.length === 0 ? (
              <p className="text-muted-foreground text-center py-4 px-4 text-sm">
                Aucun câble dans le réseau
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Câble</TableHead>
                    <TableHead className="text-xs">U dép.(V)</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">L (m)</TableHead>
                    <TableHead className="text-xs">I (A)</TableHead>
                    <TableHead className="text-xs">ΔU (%)</TableHead>
                    <TableHead className="text-xs">Pertes (kW)</TableHead>
                    <TableHead className="text-xs">U arr.(V)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentResult.cables
                    .sort((a, b) => {
                      // Extraire le numéro du nom du câble (ex: "Câble 1" -> 1)
                      const getNumber = (name: string) => {
                        const match = name.match(/Câble (\d+)/);
                        return match ? parseInt(match[1], 10) : 999999; // Les câbles sans numéro à la fin
                      };
                      return getNumber(a.name) - getNumber(b.name);
                    })
                    .map((cable) => {
                      // Récupérer les informations du câble depuis le projet
                      const projectCable = currentProject?.cables.find(c => c.id === cable.id);
                      const cableType = currentProject?.cableTypes.find(ct => ct.id === projectCable?.typeId);
                      
                      // Récupérer les nœuds du câble
                      const nodeA = currentProject?.nodes.find(n => n.id === projectCable?.nodeAId);
                      const nodeB = currentProject?.nodes.find(n => n.id === projectCable?.nodeBId);
                      
                      // Déterminer quel nœud est la source et lequel est l'aval
                      const sourceNode = nodeA?.isSource ? nodeA : nodeB?.isSource ? nodeB : nodeA;
                      const distalNode = sourceNode === nodeA ? nodeB : nodeA;
                      
                      // Si aucun des deux n'est source directe, utiliser les tensions cibles
                      let actualSourceNode = sourceNode;
                      let actualDistalNode = distalNode;
                      
                      if (!nodeA?.isSource && !nodeB?.isSource) {
                        const voltageA = nodeA?.tensionCible || (currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230);
                        const voltageB = nodeB?.tensionCible || (currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230);
                        
                        if (voltageA >= voltageB) {
                          actualSourceNode = nodeA;
                          actualDistalNode = nodeB;
                        } else {
                          actualSourceNode = nodeB;
                          actualDistalNode = nodeA;
                        }
                      }
                      
                      // Calculer les tensions
                      const baseVoltage = currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230;
                      const sourceNodeVoltage = actualSourceNode?.tensionCible || baseVoltage;
                      
                      // La tension aval basée sur les résultats de calcul
                      const nodeVoltageDropResult = currentResult.nodeVoltageDrops?.find(nvd => nvd.nodeId === actualDistalNode?.id);
                      const cumulativeVoltageDrop = nodeVoltageDropResult?.deltaU_cum_V || 0;
                      const distalNodeVoltage = sourceNodeVoltage - cumulativeVoltageDrop;
                      
                      return (
                        <TableRow key={cable.id}>
                          <TableCell className="text-xs">{cable.name}</TableCell>
                          <TableCell className="text-xs">{sourceNodeVoltage.toFixed(0)}</TableCell>
                          <TableCell className="text-xs">{cableType?.label || '-'}</TableCell>
                          <TableCell className="text-xs">{cable.length_m?.toFixed(0) || '-'}</TableCell>
                          <TableCell className="text-xs">
                            {cable.current_A?.toFixed(1) || '-'}
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className={`font-medium ${
                              Math.abs(cable.voltageDropPercent || 0) > 10 
                                ? 'text-destructive' 
                                : Math.abs(cable.voltageDropPercent || 0) > 8 
                                ? 'text-accent' 
                                : 'text-success'
                            }`}>
                              {cable.voltageDropPercent?.toFixed(2) || '-'}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs">
                            {cable.losses_kW?.toFixed(3) || '-'}
                          </TableCell>
                          <TableCell className="text-xs">{distalNodeVoltage.toFixed(0)}</TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};