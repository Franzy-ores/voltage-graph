import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalculationResult, CalculationScenario, VirtualBusbar } from "@/types/network";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNetworkStore } from '@/store/networkStore';
import { jsPDF } from 'jspdf';
import { getConnectedNodes, getConnectedCables } from '@/utils/networkConnectivity';
import { getNodeConnectionType } from '@/utils/nodeConnectionType';


interface ResultsPanelProps {
  results: {
    [key in CalculationScenario]: CalculationResult | null;
  };
  selectedScenario: CalculationScenario;
  isCollapsed?: boolean;
}

export const ResultsPanel = ({ results, selectedScenario, isCollapsed = false }: ResultsPanelProps) => {
  const { currentProject, simulationResults, toggleResultsPanel, toggleResultsPanelFullscreen, simulationEquipment, isSimulationActive, resultsPanelFullscreen } = useNetworkStore();
  
  const currentResult = results[selectedScenario];

  // Fonction pour obtenir la numérotation séquentielle des circuits
  const getCircuitNumber = (circuitId: string): number => {
    if (!currentResult?.virtualBusbar?.circuits || !currentProject) return 0;
    
    // Trouver la source
    const sourceNode = currentProject.nodes.find(n => n.isSource);
    if (!sourceNode) return 0;
    
    // Obtenir tous les câbles directement connectés à la source (circuits principaux)
    const mainCircuitCables = currentProject.cables
      .filter(cable => cable.nodeAId === sourceNode.id || cable.nodeBId === sourceNode.id)
      .sort((a, b) => a.id.localeCompare(b.id)); // Tri pour assurer la cohérence
    
    // Trouver l'index du circuit
    const circuitIndex = mainCircuitCables.findIndex(cable => cable.id === circuitId);
    return circuitIndex >= 0 ? circuitIndex + 1 : 0;
  };

  // Fonction pour identifier le circuit d'un nœud
  const getNodeCircuit = (nodeId: string): { circuitId: string; circuitName: string; circuitNumber: number } | null => {
    if (!currentResult?.virtualBusbar?.circuits || !currentProject) return null;
    
    // Si c'est la source, pas de circuit
    const node = currentProject.nodes.find(n => n.id === nodeId);
    if (node?.isSource) return null;
    
    // Chercher dans quel circuit se trouve ce nœud
    for (const circuit of currentResult.virtualBusbar.circuits) {
      const cable = currentProject.cables.find(c => c.id === circuit.circuitId);
      if (cable && (cable.nodeAId === nodeId || cable.nodeBId === nodeId)) {
        const circuitNumber = getCircuitNumber(circuit.circuitId);
        return {
          circuitId: circuit.circuitId,
          circuitName: `Circuit ${circuitNumber}`,
          circuitNumber
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
    
    // Fonction pour trouver tous les câbles dans un sous-arbre à partir d'un nœud
    const getAllCablesInSubtree = (startNodeId: string, sourceNodeId: string): string[] => {
      const cableIds = new Set<string>();
      const visited = new Set<string>();
      const stack = [startNodeId];
      
      while (stack.length > 0) {
        const currentNodeId = stack.pop()!;
        if (visited.has(currentNodeId)) continue;
        visited.add(currentNodeId);
        
        // Trouver tous les câbles connectés à ce nœud (sauf ceux qui remontent vers la source)
        const connectedCablesFromNode = currentProject.cables.filter(cable => {
          const isConnected = cable.nodeAId === currentNodeId || cable.nodeBId === currentNodeId;
          const otherNodeId = cable.nodeAId === currentNodeId ? cable.nodeBId : cable.nodeAId;
          
          // Inclure le câble si il est connecté et ne remonte pas directement vers la source
          // (sauf si c'est le câble principal du circuit)
          return isConnected && (otherNodeId !== sourceNodeId || cableIds.size === 0);
        });
        
        connectedCablesFromNode.forEach(cable => {
          if (!cableIds.has(cable.id)) {
            cableIds.add(cable.id);
            
            // Ajouter le nœud de l'autre côté à explorer
            const otherNodeId = cable.nodeAId === currentNodeId ? cable.nodeBId : cable.nodeAId;
            if (!visited.has(otherNodeId) && otherNodeId !== sourceNodeId) {
              stack.push(otherNodeId);
            }
          }
        });
      }
      
      return Array.from(cableIds);
    };
    
    let totalLength = 0;
    const circuitStats: Array<{
      circuitId: string;
      circuitName: string;
      circuitNumber: number;
      length: number;
      cableCount: number;
      subtreeSkVA: number;
      direction: string;
      cables: any[];
    }> = [];
    
    // Trouver la source
    const sourceNode = currentProject.nodes.find(n => n.isSource);
    if (!sourceNode) {
      return { totalLength: 0, circuitStats: [], connectedCableCount: connectedCables.length };
    }
    
    // Grouper par circuit (trié par numéro de circuit)
    const sortedCircuits = currentResult.virtualBusbar.circuits
      .map(circuit => ({ ...circuit, circuitNumber: getCircuitNumber(circuit.circuitId) }))
      .sort((a, b) => a.circuitNumber - b.circuitNumber);
    
    const allAssignedCableIds = new Set<string>();
    
    sortedCircuits.forEach(circuit => {
      // Trouver le câble principal du circuit
      const mainCable = currentProject.cables.find(c => c.id === circuit.circuitId);
      if (!mainCable) return;
      
      // Déterminer le nœud aval (celui qui n'est pas la source)
      const downstreamNodeId = mainCable.nodeAId === sourceNode.id ? mainCable.nodeBId : mainCable.nodeAId;
      
      // Trouver tous les câbles dans le sous-arbre de ce circuit
      const subtreeCableIds = getAllCablesInSubtree(downstreamNodeId, sourceNode.id);
      
      // S'assurer que le câble principal est inclus
      if (!subtreeCableIds.includes(circuit.circuitId)) {
        subtreeCableIds.unshift(circuit.circuitId);
      }
      
      // Filtrer pour ne garder que les câbles connectés et pas déjà assignés
      const circuitCables = connectedCables.filter(cable => {
        const isInSubtree = subtreeCableIds.includes(cable.id);
        const notAlreadyAssigned = !allAssignedCableIds.has(cable.id);
        
        if (isInSubtree && notAlreadyAssigned) {
          allAssignedCableIds.add(cable.id);
          return true;
        }
        return false;
      });
      
      const circuitLength = circuitCables.reduce((sum, cable) => sum + (cable.length_m || 0), 0);
      totalLength += circuitLength;
      
      const circuitNumber = getCircuitNumber(circuit.circuitId);
      
      circuitStats.push({
        circuitId: circuit.circuitId,
        circuitName: `Circuit ${circuitNumber}`,
        circuitNumber,
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
    console.log('🐛 ResultsPanel - Missing data:', { results: !!results, selectedScenario });
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
    console.log('🐛 ResultsPanel - No current result for scenario:', selectedScenario);
    console.log('🐛 Available results:', Object.keys(results));
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

  if (isCollapsed) {
    return (
      <div className="w-12 bg-card border-l border-border flex flex-col items-center py-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleResultsPanel}
          title="Afficher les résultats"
          className="rotate-180"
        >
          <span className="text-lg">📊</span>
        </Button>
      </div>
    );
  }

  return (
    <div className={resultsPanelFullscreen 
      ? "fixed inset-0 z-50 w-full bg-card overflow-y-auto"
      : "w-80 bg-card border-l border-border overflow-y-auto"
    }>
      <div className="p-4 space-y-4">
        
        {/* Global Summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center justify-between">
              <span>Résumé Global</span>
              <div className="flex items-center gap-2">
                {getComplianceBadge(currentResult.compliance)}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleResultsPanelFullscreen}
                  title={resultsPanelFullscreen ? "Vue normale" : "Plein écran"}
                  className="h-8 w-8"
                >
                  {resultsPanelFullscreen ? '👁️‍🗨️' : '👁️'}
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Section 1: Charges et Productions en 2 colonnes */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <p className="text-muted-foreground">Charge contract.</p>
                <p className="font-semibold">{(() => {
                  if (!currentProject?.nodes || !currentProject?.cables) return '0.0';
                  const connectedNodes = getConnectedNodes(currentProject.nodes, currentProject.cables);
                  const connectedNodesData = currentProject.nodes.filter(node => connectedNodes.has(node.id));
                  return connectedNodesData.reduce((sum, node) => 
                    sum + node.clients.reduce((clientSum, client) => clientSum + client.S_kVA, 0), 0).toFixed(1);
                })()} kVA</p>
              </div>
              <div>
                <p className="text-muted-foreground">Production contract.</p>
                <p className="font-semibold">{(() => {
                  if (!currentProject?.nodes || !currentProject?.cables) return '0.0';
                  const connectedNodes = getConnectedNodes(currentProject.nodes, currentProject.cables);
                  const connectedNodesData = currentProject.nodes.filter(node => connectedNodes.has(node.id));
                  return connectedNodesData.reduce((sum, node) => 
                    sum + node.productions.reduce((prodSum, prod) => prodSum + prod.S_kVA, 0), 0).toFixed(1);
                })()} kVA</p>
              </div>
              <div>
                <p className="text-muted-foreground">Foisonnement charges</p>
                <p className="font-semibold">{currentProject?.foisonnementCharges || 100}%</p>
              </div>
              <div>
                <p className="text-muted-foreground">Foisonnement production</p>
                <p className="font-semibold">{currentProject?.foisonnementProductions || 100}%</p>
              </div>
              <div>
                <p className="text-muted-foreground">Charge foisonnée</p>
                <p className="font-semibold">{currentResult.totalLoads_kVA.toFixed(1)} kVA</p>
              </div>
              <div>
                <p className="text-muted-foreground">Production foisonnée</p>
                <p className="font-semibold">{(() => {
                  if (!currentProject?.nodes || !currentProject?.cables) return '0.0';
                  const connectedNodes = getConnectedNodes(currentProject.nodes, currentProject.cables);
                  const connectedNodesData = currentProject.nodes.filter(node => connectedNodes.has(node.id));
                  const totalProdContractuelle = connectedNodesData.reduce((sum, node) => 
                    sum + node.productions.reduce((prodSum, prod) => prodSum + prod.S_kVA, 0), 0);
                  const foisonnement = currentProject?.foisonnementProductions || 100;
                  return (totalProdContractuelle * foisonnement / 100).toFixed(1);
                })()} kVA</p>
              </div>
            </div>

            {/* Section 2: Modèle de charge */}
            <div className="pt-2 border-t">
              <div className="text-xs">
                <p className="text-muted-foreground">Modèle de charge</p>
                <p className="font-semibold">
                  {currentProject?.loadModel === 'monophase_reparti' ? 'Monophasé réparti' : 'Polyphasé équilibré'}
                </p>
              </div>
            </div>

            {/* Section 3: Jeu de barres (mode monophasé uniquement) */}
            {currentProject?.loadModel === 'monophase_reparti' && (
              <div className="text-xs">
                <p className="text-muted-foreground mb-1">Jeu de barres</p>
                {(() => {
                  const busbar = currentResult?.virtualBusbar;
                  if (busbar) {
                    return (
                      <p className="font-semibold">
                        I_N: {busbar.current_N !== undefined ? busbar.current_N.toFixed(1) : '0.0'}A - 
                        ΔU: {busbar.deltaU_V >= 0 ? '+' : ''}{busbar.deltaU_V.toFixed(2)}V
                      </p>
                    );
                  } else {
                    return (
                      <p className="font-semibold text-muted-foreground">
                        Données non disponibles
                      </p>
                    );
                  }
                })()}
              </div>
            )}

            {/* Section 4: Chute max. et Pertes globales */}
            <div className="pt-2 border-t grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <p className="text-muted-foreground">Chute max.</p>
                <p className="font-semibold">
                  {currentResult.maxVoltageDropPercent.toFixed(2)}%
                  {currentResult.maxVoltageDropCircuitNumber && (
                    <span className="text-muted-foreground text-xs ml-1">
                      (C{currentResult.maxVoltageDropCircuitNumber})
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Pertes globales</p>
                <p className="font-semibold">{currentResult.globalLosses_kW.toFixed(3)} kW</p>
              </div>
            </div>

            {/* Section SRG2 - Affichage si simulation active */}
            {isSimulationActive && simulationEquipment?.srg2Devices?.some(srg2 => srg2.enabled) && (
              <div className="pt-3 border-t space-y-2">
                {simulationEquipment.srg2Devices
                  .filter(srg2 => srg2.enabled)
                  .map(srg2 => {
                    const node = currentProject?.nodes.find(n => n.id === srg2.nodeId);
                    return (
                      <Card key={srg2.id} className="border-orange-300 border-2 bg-orange-50/50">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">
                            📍 SRG2 - {node?.name || srg2.nodeId}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="text-xs space-y-2">
                          <div>
                            <p className="text-muted-foreground font-medium mb-1">
                              Résultats de régulation:
                            </p>
                            {srg2.tensionEntree && (
                              <div className="pl-2">
                                <p className="text-muted-foreground">Tensions d'entrée:</p>
                                <p className="font-mono">
                                  A: {srg2.tensionEntree.A.toFixed(1)}V, 
                                  B: {srg2.tensionEntree.B.toFixed(1)}V, 
                                  C: {srg2.tensionEntree.C.toFixed(1)}V
                                </p>
                              </div>
                            )}
                            {srg2.etatCommutateur && (
                              <div className="pl-2">
                                <p className="text-muted-foreground">États commutateurs:</p>
                                <p className="font-mono">
                                  A: {srg2.etatCommutateur.A}, 
                                  B: {srg2.etatCommutateur.B}, 
                                  C: {srg2.etatCommutateur.C}
                                </p>
                              </div>
                            )}
                            {srg2.coefficientsAppliques && (
                              <div className="pl-2">
                                <p className="text-muted-foreground">Coefficients:</p>
                                <p className="font-mono">
                                  A: {srg2.coefficientsAppliques.A > 0 ? '+' : ''}
                                  {srg2.coefficientsAppliques.A.toFixed(1)}%, 
                                  B: {srg2.coefficientsAppliques.B > 0 ? '+' : ''}
                                  {srg2.coefficientsAppliques.B.toFixed(1)}%, 
                                  C: {srg2.coefficientsAppliques.C > 0 ? '+' : ''}
                                  {srg2.coefficientsAppliques.C.toFixed(1)}%
                                </p>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
            )}

            {/* Section EQUI8 - Affichage si simulation active */}
            {isSimulationActive && simulationEquipment?.neutralCompensators?.some(comp => comp.enabled) && (
              <div className="pt-3 border-t space-y-2">
                {simulationEquipment.neutralCompensators
                  .filter(comp => comp.enabled)
                  .map(comp => {
                    const node = currentProject?.nodes.find(n => n.id === comp.nodeId);
                    return (
                      <Card key={comp.id} className="border-orange-300 border-2 bg-orange-50/50">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">
                            📍 EQUI8 - {node?.name || comp.nodeId}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="text-xs space-y-2">
                          <div>
                            <p className="text-muted-foreground font-medium mb-1">
                              Résultats EQUI8:
                            </p>
                            <div className="pl-2 space-y-1">
                              {comp.currentIN_A !== undefined && (
                                <p>I-EQUI8: <span className="font-mono">{comp.currentIN_A.toFixed(1)} A</span></p>
                              )}
                              {comp.reductionPercent !== undefined && (
                                <p>Réduction: <span className="font-mono">{comp.reductionPercent.toFixed(1)}%</span></p>
                              )}
                              {comp.u1p_V !== undefined && (
                                <>
                                  <p className="text-muted-foreground">Tensions (Ph-N):</p>
                                  <p className="font-mono">
                                    Ph1: {comp.u1p_V.toFixed(1)} V, 
                                    Ph2: {comp.u2p_V?.toFixed(1)} V, 
                                    Ph3: {comp.u3p_V?.toFixed(1)} V
                                  </p>
                                </>
                              )}
                              {comp.umoy_init_V !== undefined && (
                                <p>Umoy init: <span className="font-mono">{comp.umoy_init_V.toFixed(1)} V</span></p>
                              )}
                              {comp.ecart_init_V !== undefined && (
                                <p>Écart init: <span className="font-mono">{comp.ecart_init_V.toFixed(1)} V</span></p>
                              )}
                              {comp.ecart_equi8_V !== undefined && (
                                <p>Écart EQUI8: <span className="font-mono">{comp.ecart_equi8_V.toFixed(1)} V</span></p>
                              )}
                              {comp.iN_initial_A !== undefined && (
                                <p>I_N initial: <span className="font-mono">{comp.iN_initial_A.toFixed(1)} A</span></p>
                              )}
                              {comp.iN_absorbed_A !== undefined && (
                                <p>I_N absorbé: <span className="font-mono">{comp.iN_absorbed_A.toFixed(1)} A</span></p>
                              )}
                              {comp.compensationQ_kVAr && (
                                <>
                                  <p className="text-muted-foreground">Puissances réactives:</p>
                                  <p className="font-mono">
                                    Q_A: {comp.compensationQ_kVAr.A.toFixed(1)} kVAr, 
                                    Q_B: {comp.compensationQ_kVAr.B.toFixed(1)} kVAr, 
                                    Q_C: {comp.compensationQ_kVAr.C.toFixed(1)} kVAr
                                  </p>
                                </>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
            )}
            
            {/* Infos Transformateur et Jeu de Barres */}
            {currentResult.virtualBusbar && (
              <div className="pt-3 border-t space-y-3">
                <div>
                  <p className="text-muted-foreground text-sm mb-2">Transformateur :</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <span>
                      {currentProject?.transformerConfig.rating} - 
                      {currentProject?.transformerConfig.shortCircuitVoltage_percent}% Ucc
                    </span>
                    <span>
                      Pertes: {currentResult.virtualBusbar.losses_kW?.toFixed(3) || 0} kW
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground text-sm mb-2">Jeu de barres :</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <span>Tension: {currentResult.virtualBusbar.voltage_V.toFixed(1)} V</span>
                    <span>Courant: {currentResult.virtualBusbar.current_A.toFixed(1)} A</span>
                    <span>Net S: {currentResult.virtualBusbar.netSkVA.toFixed(1)} kVA</span>
                    <span>ΔU: {currentResult.virtualBusbar.deltaU_percent?.toFixed(2) || 0}%</span>
                  </div>
                </div>
              </div>
            )}

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

        {/* Scenario Selection & Convergence Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Scénario Actuel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium">{formatScenarioName(selectedScenario)}</p>
            
            {/* Affichage du statut de convergence pour le mode FORCÉ */}
            {selectedScenario === 'FORCÉ' && (
              <div className="space-y-2">
                {(() => {
                  // Utiliser simulationResults déjà récupéré en haut du composant
                  const simResult = simulationResults[selectedScenario];
                  const convergenceStatus = simResult?.convergenceStatus || (currentResult as any)?.convergenceStatus;
                  
                  if (convergenceStatus) {
                    return (
                      <div className={`text-xs px-2 py-1 rounded flex items-center gap-2 ${
                        convergenceStatus === 'converged' 
                          ? 'bg-green-100 text-green-800 border border-green-200' 
                          : 'bg-red-100 text-red-800 border border-red-200'
                      }`}>
                        {convergenceStatus === 'converged' ? (
                          <>
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span>Simulation du réseau convergée</span>
                          </>
                        ) : (
                          <>
                            <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                            <span>⚠️ Simulation non convergente - Réseau instable</span>
                          </>
                        )}
                      </div>
                    );
                  } else {
                    return (
                      <div className="text-xs px-2 py-1 rounded flex items-center gap-2 bg-gray-100 text-gray-600 border border-gray-200">
                        <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                        <span>Mode forcé configuré - Cliquez sur "Appliquer" pour simuler</span>
                      </div>
                    );
                  }
                })()}
                
                {/* Bouton de sauvegarde si convergé */}
                {(() => {
                  const simResult = simulationResults[selectedScenario];
                  const convergenceStatus = simResult?.convergenceStatus || (currentResult as any)?.convergenceStatus;
                  
                  if (convergenceStatus === 'converged') {
                    return (
                      <button
                        onClick={() => {
                          if (confirm('Sauvegarder la répartition des charges et productions utilisées dans cette simulation dans la configuration du projet ?')) {
                            // Fonction de sauvegarde à implémenter
                            alert('Fonctionnalité de sauvegarde à implémenter');
                          }
                        }}
                        className="w-full text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded px-2 py-1 transition-colors"
                      >
                        💾 Sauvegarder la configuration simulée
                      </button>
                    );
                  }
                  return null;
                })()}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Node Voltages */}
        {currentResult?.nodeMetrics && currentResult.nodeMetrics.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tensions des Nœuds</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 text-xs max-h-48 overflow-y-auto">
                {currentResult.nodeMetrics.map((metric) => {
                  const node = currentProject?.nodes.find(n => n.id === metric.nodeId);
                  if (!node) return null;
                  
                  // Calculer la tension ligne pour l'affichage
                  const lineVoltage = (() => {
                    const config = (() => {
                      switch (node.connectionType) {
                        case 'MONO_230V_PN':
                        case 'MONO_230V_PP':
                          return { isThreePhase: false };
                        case 'TRI_230V_3F':
                        case 'TÉTRA_3P+N_230_400V':
                        default:
                          return { isThreePhase: true };
                      }
                    })();
                    
                    return config.isThreePhase ? metric.V_phase_V * Math.sqrt(3) : metric.V_phase_V;
                  })();
                  
                  // Déterminer la conformité de tension
                  const nominalVoltage = currentProject?.voltageSystem === 'TRIPHASÉ_230V' ? 230 : 400;
                  const voltageDropPercent = Math.abs((nominalVoltage - lineVoltage) / nominalVoltage * 100);
                  
                  let complianceColor = 'text-green-600';
                  if (voltageDropPercent > 10) complianceColor = 'text-red-600';
                  else if (voltageDropPercent > 8) complianceColor = 'text-orange-600';
                  
                  return (
                    <div key={metric.nodeId} className="flex justify-between items-center">
                      <span className="truncate pr-2">
                        {node.name}
                        {node.isSource && <span className="text-muted-foreground ml-1">(Source)</span>}
                      </span>
                      <div className="text-right">
                        <span className={`font-medium ${complianceColor}`}>
                          {lineVoltage.toFixed(1)} V
                        </span>
                        <div className="text-muted-foreground text-xs">
                          {voltageDropPercent > 0.1 ? `${voltageDropPercent > 0 ? '-' : '+'}${voltageDropPercent.toFixed(1)}%` : '0%'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Comparison by Circuits */}
        {currentResult?.virtualBusbar?.circuits && currentResult.virtualBusbar.circuits.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Comparaison des Circuits</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-xs">
                    {circuitStats.circuitStats.map((circuit) => {
                      // Trouver le circuit dans virtualBusbar pour la conformité
                      const busbarCircuit = currentResult.virtualBusbar?.circuits.find(c => c.circuitId === circuit.circuitId);
                      
                      // Déterminer la conformité du circuit basée sur la tension min/max
                      let circuitCompliance: 'normal' | 'warning' | 'critical' = 'normal';
                      if (busbarCircuit) {
                        const nominalVoltage = currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230;
                        const minDropPercent = Math.abs((nominalVoltage - busbarCircuit.minNodeVoltage_V) / nominalVoltage * 100);
                        const maxDropPercent = Math.abs((nominalVoltage - busbarCircuit.maxNodeVoltage_V) / nominalVoltage * 100);
                        const worstDrop = Math.max(minDropPercent, maxDropPercent);
                        
                        if (worstDrop > 10) circuitCompliance = 'critical';
                        else if (worstDrop > 8) circuitCompliance = 'warning';
                      }
                      
                      // Indicateur coloré de conformité
                      const getComplianceIcon = (compliance: 'normal' | 'warning' | 'critical') => {
                        const colors = {
                          normal: 'bg-blue-500',
                          warning: 'bg-orange-500', 
                          critical: 'bg-red-500'
                        };
                        return (
                          <div className={`w-3 h-3 rounded-full ${colors[compliance]} flex-shrink-0`} />
                        );
                      };

                      return (
                        <div key={circuit.circuitId} className="p-2 rounded border border-border">
                          <div className="flex items-center gap-2 mb-1">
                            {getComplianceIcon(circuitCompliance)}
                            <p className="font-medium">{circuit.circuitName}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <span>Puissance: {Math.abs(circuit.subtreeSkVA).toFixed(1)} kVA</span>
                            <span>Longueur: {circuit.length.toFixed(0)} m</span>
                            <span>Direction: {circuit.direction}</span>
                            <span>Câbles: {circuit.cableCount}</span>
                            {busbarCircuit?.subtreeQkVAr !== undefined && (
                              <span>Q: {Math.abs(busbarCircuit.subtreeQkVAr).toFixed(1)} kVAr</span>
                            )}
                            {busbarCircuit && (
                              <>
                                <span>U min: {busbarCircuit.minNodeVoltage_V.toFixed(1)} V</span>
                                <span>U max: {busbarCircuit.maxNodeVoltage_V.toFixed(1)} V</span>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
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
                          {currentProject?.loadModel === 'monophase_reparti' && currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V' && (
                            <TableHead className="text-xs">I_N (A)</TableHead>
                          )}
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
                                     Circuit {circuit.circuitNumber}
                                   </div>
                                 </TableCell>
                                 <TableCell className="text-xs">{sourceNodeVoltage.toFixed(0)}</TableCell>
                                <TableCell className="text-xs">{cableType?.label || '-'}</TableCell>
                                <TableCell className="text-xs">{cable.length_m?.toFixed(0) || '-'}</TableCell>
                               <TableCell className="text-xs">
                                 {cable.current_A?.toFixed(1) || '-'}
                               </TableCell>
                               {currentProject?.loadModel === 'monophase_reparti' && currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V' && (
                                 <TableCell className="text-xs">
                                   {cable.currentsPerPhase_A?.N?.toFixed(1) || '-'}
                                 </TableCell>
                               )}
                                <TableCell className="text-xs">
                                  <span className={`font-medium ${
                                    (() => {
                                        const nominalVoltage = currentProject && actualDistalNode 
                                          ? (getNodeConnectionType(currentProject.voltageSystem, currentProject.loadModel || 'polyphase_equilibre', actualDistalNode?.isSource) === 'TÉTRA_3P+N_230_400V' ? 400 : 230)
                                         : 230;
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
                          {currentProject?.loadModel === 'monophase_reparti' && currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V' && (
                            <TableHead className="text-xs">I_N (A)</TableHead>
                          )}
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
                                 {currentProject?.loadModel === 'monophase_reparti' && currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V' && (
                                   <TableCell className="text-xs">
                                     {cable.currentsPerPhase_A?.N?.toFixed(1) || '-'}
                                   </TableCell>
                                 )}
                                <TableCell className="text-xs">
                                  <span className={`font-medium ${
                                    (() => {
                                        const nominalVoltage = currentProject && actualDistalNode 
                                          ? (getNodeConnectionType(currentProject.voltageSystem, currentProject.loadModel || 'polyphase_equilibre', actualDistalNode?.isSource) === 'TÉTRA_3P+N_230_400V' ? 400 : 230)
                                         : 230;
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

        {/* Node Voltage Details for Mono-phase networks */}
        {currentProject?.loadModel === 'monophase_reparti' && currentResult?.nodePhasorsPerPhase && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tensions Nodales par Phase</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {(() => {
                  // Grouper les tensions par nœud
                  const nodeGroups = new Map<string, typeof currentResult.nodePhasorsPerPhase>();
                  currentResult.nodePhasorsPerPhase.forEach(phasor => {
                    if (!nodeGroups.has(phasor.nodeId)) {
                      nodeGroups.set(phasor.nodeId, []);
                    }
                    nodeGroups.get(phasor.nodeId)!.push(phasor);
                  });

                  return Array.from(nodeGroups.entries()).map(([nodeId, phasors]) => {
                    const node = currentProject?.nodes.find(n => n.id === nodeId);
                    if (!node) return null;

                    const phaseA = phasors.find(p => p.phase === 'A');
                    const phaseB = phasors.find(p => p.phase === 'B');
                    const phaseC = phasors.find(p => p.phase === 'C');

                    return (
                      <div key={nodeId} className="border rounded-lg p-3">
                        <div className="font-medium text-sm mb-2">
                          {node.name || `Nœud ${nodeId.slice(0, 8)}`}
                          {node.isSource && <span className="text-xs text-muted-foreground ml-2">(Source)</span>}
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-xs">
                          <div className="text-center">
                            <div className="font-medium text-blue-600">Phase A</div>
                            <div className="mt-1">
                              <div>{phaseA?.V_phase_V.toFixed(1) || '-'} V</div>
                              <div className="text-muted-foreground">{phaseA?.V_angle_deg.toFixed(1) || '-'}°</div>
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="font-medium text-green-600">Phase B</div>
                            <div className="mt-1">
                              <div>{phaseB?.V_phase_V.toFixed(1) || '-'} V</div>
                              <div className="text-muted-foreground">{phaseB?.V_angle_deg.toFixed(1) || '-'}°</div>
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="font-medium text-red-600">Phase C</div>
                            <div className="mt-1">
                              <div>{phaseC?.V_phase_V.toFixed(1) || '-'} V</div>
                              <div className="text-muted-foreground">{phaseC?.V_angle_deg.toFixed(1) || '-'}°</div>
                            </div>
                          </div>
                        </div>
                        {/* Tensions composées */}
                        <div className="mt-3 pt-2 border-t">
                          <div className="text-xs font-medium mb-2">Tensions composées</div>
                          <div className="grid grid-cols-3 gap-3 text-xs">
                            {phaseA && phaseB && (
                              <div className="text-center">
                                <div className="font-medium">U_AB</div>
                                <div>{(() => {
                                  // Pour MONO_230V_PP (réseau 230V), la tension entre phases est directe (230V)
                                  // Pour MONO_230V_PN (réseau 400V), utiliser √3
                                  const nodeType = node.connectionType;
                                  if (nodeType === 'MONO_230V_PP' || currentProject?.voltageSystem === 'TRIPHASÉ_230V') {
                                    return Math.min(phaseA.V_phase_V, phaseB.V_phase_V).toFixed(1);
                                  } else {
                                    return (Math.sqrt(3) * Math.min(phaseA.V_phase_V, phaseB.V_phase_V)).toFixed(1);
                                  }
                                })()} V</div>
                              </div>
                            )}
                            {phaseB && phaseC && (
                              <div className="text-center">
                                <div className="font-medium">U_BC</div>
                                <div>{(() => {
                                  const nodeType = node.connectionType;
                                  if (nodeType === 'MONO_230V_PP' || currentProject?.voltageSystem === 'TRIPHASÉ_230V') {
                                    return Math.min(phaseB.V_phase_V, phaseC.V_phase_V).toFixed(1);
                                  } else {
                                    return (Math.sqrt(3) * Math.min(phaseB.V_phase_V, phaseC.V_phase_V)).toFixed(1);
                                  }
                                })()} V</div>
                              </div>
                            )}
                            {phaseC && phaseA && (
                              <div className="text-center">
                                <div className="font-medium">U_CA</div>
                                <div>{(() => {
                                  const nodeType = node.connectionType;
                                  if (nodeType === 'MONO_230V_PP' || currentProject?.voltageSystem === 'TRIPHASÉ_230V') {
                                    return Math.min(phaseC.V_phase_V, phaseA.V_phase_V).toFixed(1);
                                  } else {
                                    return (Math.sqrt(3) * Math.min(phaseC.V_phase_V, phaseA.V_phase_V)).toFixed(1);
                                  }
                                })()} V</div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }).filter(Boolean);
                })()}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};