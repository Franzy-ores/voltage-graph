import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalculationResult, CalculationScenario, VirtualBusbar } from "@/types/network";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNetworkStore } from '@/store/networkStore';
import { getConnectedNodes, getConnectedCables } from '@/utils/networkConnectivity';

interface ResultsPanelProps {
  results: {
    [key in CalculationScenario]: CalculationResult | null;
  };
  selectedScenario: CalculationScenario;
}

export const ResultsPanel = ({ results, selectedScenario }: ResultsPanelProps) => {
  const { currentProject } = useNetworkStore();
  
  const currentResult = results[selectedScenario];

  // Fonction pour identifier le circuit d'un nœud
  const getNodeCircuit = (nodeId: string): { circuitId: string; circuitName: string } | null => {
    if (!currentResult?.virtualBusbar?.circuits || !currentProject) return null;
    
    // Si c'est la source, pas de circuit
    const node = currentProject.nodes.find(n => n.id === nodeId);
    if (node?.isSource) return null;
    
    // Chercher dans quel circuit se trouve ce nœud
    for (const circuit of currentResult.virtualBusbar.circuits) {
      const cable = currentProject.cables.find(c => c.id === circuit.circuitId);
      if (cable && (cable.nodeAId === nodeId || cable.nodeBId === nodeId)) {
        return {
          circuitId: circuit.circuitId,
          circuitName: `Circuit ${circuit.circuitId.replace('cable-', '')}`
        };
      }
    }
    return null;
  };

  // Calculer les statistiques par circuit
  const getCircuitStatistics = () => {
    if (!currentProject?.cables || !currentProject?.nodes || !currentResult?.virtualBusbar?.circuits) {
      return { totalLength: 0, circuitStats: [], connectedCableCount: 0 };
    }
    
    const connectedNodes = getConnectedNodes(currentProject.nodes, currentProject.cables);
    const connectedCables = getConnectedCables(currentProject.cables, connectedNodes);
    
    let totalLength = 0;
    const circuitStats: Array<{
      circuitId: string;
      circuitName: string;
      length: number;
      cableCount: number;
      subtreeSkVA: number;
      direction: string;
      cables: any[];
    }> = [];
    
    // Grouper par circuit
    currentResult.virtualBusbar.circuits.forEach(circuit => {
      const circuitCables = connectedCables.filter(cable => {
        // Trouver tous les câbles qui appartiennent à ce circuit
        const mainCable = currentProject.cables.find(c => c.id === circuit.circuitId);
        if (!mainCable) return false;
        
        // Pour simplifier, on considère qu'un câble appartient au circuit si il est connecté au nœud aval du câble principal
        const mainCableTargetNodeId = mainCable.nodeAId === currentProject.nodes.find(n => n.isSource)?.id 
          ? mainCable.nodeBId 
          : mainCable.nodeAId;
        
        return cable.nodeAId === mainCableTargetNodeId || cable.nodeBId === mainCableTargetNodeId || cable.id === circuit.circuitId;
      });
      
      const circuitLength = circuitCables.reduce((sum, cable) => sum + (cable.length_m || 0), 0);
      totalLength += circuitLength;
      
      circuitStats.push({
        circuitId: circuit.circuitId,
        circuitName: `Circuit ${circuit.circuitId.replace('cable-', '')}`,
        length: circuitLength,
        cableCount: circuitCables.length,
        subtreeSkVA: circuit.subtreeSkVA,
        direction: circuit.direction,
        cables: circuitCables
      });
    });
    
    return { totalLength, circuitStats, connectedCableCount: connectedCables.length };
  };
  
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
  
  // currentResult moved up to avoid TDZ error

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

  const circuitStats = getCircuitStatistics();

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
                  <p className="font-semibold">{(() => {
                    if (!currentProject?.nodes || !currentProject?.cables) return '0.0';
                    const connectedNodes = getConnectedNodes(currentProject.nodes, currentProject.cables);
                    const connectedNodesData = currentProject.nodes.filter(node => connectedNodes.has(node.id));
                    return connectedNodesData.reduce((sum, node) => 
                      sum + node.clients.reduce((clientSum, client) => clientSum + client.S_kVA, 0), 0).toFixed(1);
                  })()} kVA</p>
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
            
            {/* Statistiques par circuit */}
            <div className="pt-3 border-t">
              <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                <div>
                  <p className="text-muted-foreground">Longueur totale</p>
                  <p className="font-semibold">{circuitStats.totalLength.toFixed(0)} m</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Nombre de câbles</p>
                  <p className="font-semibold">{circuitStats.connectedCableCount}</p>
                </div>
              </div>
              
              {/* Détail par circuit */}
              {circuitStats.circuitStats.length > 0 && (
                <div>
                  <p className="text-muted-foreground text-xs mb-2">Longueur par circuit :</p>
                  <div className="space-y-1">
                    {circuitStats.circuitStats.map((circuit) => (
                      <div key={circuit.circuitId} className="flex justify-between text-xs">
                        <span className="truncate pr-2">
                          {circuit.circuitName}
                          <span className="text-muted-foreground ml-1">
                            ({circuit.direction})
                          </span>
                        </span>
                        <span className="font-medium">{circuit.length.toFixed(0)} m</span>
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

        {/* Comparison by Circuits */}
        {currentResult?.virtualBusbar?.circuits && currentResult.virtualBusbar.circuits.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Comparaison des Circuits</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-xs">
                {circuitStats.circuitStats.map((circuit) => (
                  <div key={circuit.circuitId} className="p-2 rounded border border-border">
                    <p className="font-medium mb-1">{circuit.circuitName}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <span>Puissance: {Math.abs(circuit.subtreeSkVA).toFixed(1)} kVA</span>
                      <span>Longueur: {circuit.length.toFixed(0)} m</span>
                      <span>Direction: {circuit.direction}</span>
                      <span>Câbles: {circuit.cableCount}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

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

        {/* Cables Details by Circuit */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Détails par Circuit</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {currentResult.cables.length === 0 ? (
              <p className="text-muted-foreground text-center py-4 px-4 text-sm">
                Aucun câble dans le réseau
              </p>
            ) : (
              <div className="space-y-4">
                {circuitStats.circuitStats.map((circuit) => (
                  <div key={circuit.circuitId}>
                    {/* Circuit Header */}
                    <div className="px-4 py-2 bg-muted/50 border-b">
                      <div className="flex justify-between items-center text-sm">
                        <span className="font-medium">{circuit.circuitName}</span>
                        <div className="text-xs text-muted-foreground">
                          {Math.abs(circuit.subtreeSkVA).toFixed(1)} kVA • {circuit.length.toFixed(0)} m • {circuit.direction}
                        </div>
                      </div>
                    </div>
                    
                    {/* Circuit Cables Table */}
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
                          .filter(cable => circuit.cables.some(c => c.id === cable.id))
                          .sort((a, b) => {
                            // Extraire le numéro du nom du câble (ex: "Câble 1" -> 1)
                            const getNumber = (name: string) => {
                              const match = name.match(/Câble (\d+)/);
                              return match ? parseInt(match[1], 10) : 999999;
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
                      
                      // Calculer les tensions réelles des nœuds
                      const baseVoltage = currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230;
                      
                      // Trouver la tension de la source principale
                      const mainSourceNode = currentProject?.nodes.find(n => n.isSource);
                      const sourceVoltage = mainSourceNode?.tensionCible || baseVoltage;
                      
                      // Tension du nœud source du câble (tension réelle après chutes cumulatives)
                      const sourceNodeVoltageDropResult = currentResult.nodeVoltageDrops?.find(nvd => nvd.nodeId === actualSourceNode?.id);
                      const sourceCumulativeVoltageDrop = sourceNodeVoltageDropResult?.deltaU_cum_V || 0;
                      const sourceNodeVoltage = sourceVoltage - sourceCumulativeVoltageDrop;
                      
                      // Tension du nœud aval du câble (tension réelle après chutes cumulatives) 
                      const distalNodeVoltageDropResult = currentResult.nodeVoltageDrops?.find(nvd => nvd.nodeId === actualDistalNode?.id);
                      const distalCumulativeVoltageDrop = distalNodeVoltageDropResult?.deltaU_cum_V || 0;
                      const distalNodeVoltage = sourceVoltage - distalCumulativeVoltageDrop;
                      
                            return (
                              <TableRow key={cable.id}>
                                <TableCell className="text-xs">
                                  {cable.name}
                                  <div className="text-muted-foreground text-xs">
                                    Circuit {circuit.circuitId.replace('cable-', '')}
                                  </div>
                                </TableCell>
                                <TableCell className="text-xs">{sourceNodeVoltage.toFixed(0)}</TableCell>
                                <TableCell className="text-xs">{cableType?.label || '-'}</TableCell>
                                <TableCell className="text-xs">{cable.length_m?.toFixed(0) || '-'}</TableCell>
                                <TableCell className="text-xs">
                                  {cable.current_A?.toFixed(1) || '-'}
                                </TableCell>
                                <TableCell className="text-xs">
                                  <span className={`font-medium ${
                                    (() => {
                                      const nominalVoltage = (actualDistalNode?.connectionType === 'TÉTRA_3P+N_230_400V') ? 400 : 230;
                                      const nominalDropPercent = Math.abs((cable.voltageDrop_V || 0) / nominalVoltage * 100);
                                      return nominalDropPercent > 10 
                                        ? 'text-destructive' 
                                        : nominalDropPercent > 8 
                                        ? 'text-accent' 
                                        : 'text-success';
                                    })()
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
                  </div>
                ))}
                
                {/* Cables not in any circuit */}
                {currentResult.cables.filter(cable => 
                  !circuitStats.circuitStats.some(circuit => 
                    circuit.cables.some(c => c.id === cable.id)
                  )
                ).length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-muted/50 border-b">
                      <span className="font-medium text-sm">Câbles isolés</span>
                    </div>
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
                          .filter(cable => 
                            !circuitStats.circuitStats.some(circuit => 
                              circuit.cables.some(c => c.id === cable.id)
                            )
                          )
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
                            
                            // Calculer les tensions réelles des nœuds
                            const baseVoltage = currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230;
                            
                            // Trouver la tension de la source principale
                            const mainSourceNode = currentProject?.nodes.find(n => n.isSource);
                            const sourceVoltage = mainSourceNode?.tensionCible || baseVoltage;
                            
                            // Tension du nœud source du câble (tension réelle après chutes cumulatives)
                            const sourceNodeVoltageDropResult = currentResult.nodeVoltageDrops?.find(nvd => nvd.nodeId === actualSourceNode?.id);
                            const sourceCumulativeVoltageDrop = sourceNodeVoltageDropResult?.deltaU_cum_V || 0;
                            const sourceNodeVoltage = sourceVoltage - sourceCumulativeVoltageDrop;
                            
                            // Tension du nœud aval du câble (tension réelle après chutes cumulatives) 
                            const distalNodeVoltageDropResult = currentResult.nodeVoltageDrops?.find(nvd => nvd.nodeId === actualDistalNode?.id);
                            const distalCumulativeVoltageDrop = distalNodeVoltageDropResult?.deltaU_cum_V || 0;
                            const distalNodeVoltage = sourceVoltage - distalCumulativeVoltageDrop;
                            
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
                                    (() => {
                                      const nominalVoltage = (actualDistalNode?.connectionType === 'TÉTRA_3P+N_230_400V') ? 400 : 230;
                                      const nominalDropPercent = Math.abs((cable.voltageDrop_V || 0) / nominalVoltage * 100);
                                      return nominalDropPercent > 10 
                                        ? 'text-destructive' 
                                        : nominalDropPercent > 8 
                                        ? 'text-accent' 
                                        : 'text-success';
                                    })()
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
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};