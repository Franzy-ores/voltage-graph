import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNetworkStore } from "@/store/networkStore";
import { NeutralCompensator, CableUpgrade } from "@/types/network";
import { NodeSelector } from "@/components/NodeSelector";
import { getNodeConnectionType } from '@/utils/nodeConnectionType';
import { toast } from "sonner";
import { DocumentationPanel } from "@/components/DocumentationPanel";
import { SRG2Panel } from "@/components/SRG2Panel";
import { Settings, Play, RotateCcw, Trash2, Plus, AlertTriangle, CheckCircle, Cable } from "lucide-react";
export const SimulationPanel = () => {
  const {
    currentProject,
    simulationMode,
    simulationEquipment,
    simulationResults,
    selectedScenario,
    toggleSimulationMode,
    addNeutralCompensator,
    removeNeutralCompensator,
    updateNeutralCompensator,
    proposeCableUpgrades,
    runSimulation,
    closeEditPanel,
    updateProjectConfig,
    updateNode
  } = useNetworkStore();
  if (!currentProject) return null;
  const nodes = currentProject.nodes.filter(n => !n.isSource);
  const currentResult = simulationResults[selectedScenario];
  const baseline = currentResult?.baselineResult;
  const CompensatorCard = ({
    compensator
  }: {
    compensator: NeutralCompensator;
  }) => {
    const node = currentProject?.nodes.find(n => n.id === compensator.nodeId);
    const is400V = currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V';
    const nodeConnectionType = node && currentProject ? getNodeConnectionType(currentProject.voltageSystem, currentProject.loadModel || 'polyphase_equilibre', node.isSource) : null;
    const isMonoPN = nodeConnectionType === 'MONO_230V_PN';
    const hasDeseq = (currentProject?.loadModel ?? 'polyphase_equilibre') === 'monophase_reparti' && (currentProject?.desequilibrePourcent ?? 0) > 0;
    const eligible = is400V && isMonoPN && hasDeseq;
    return <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-green-500" />
              <CardTitle className="text-sm">Compensateur de neutre</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={compensator.enabled} onCheckedChange={enabled => {
              if (!eligible) return;
              updateNeutralCompensator(compensator.id, {
                enabled
              });
              // Déclencher automatiquement la simulation quand un compensateur est activé
              if (enabled) {
                console.log('🔄 Auto-triggering simulation after compensator activation');
                setTimeout(() => runSimulation(), 100);
              }
            }} disabled={!eligible} />
              <Button variant="ghost" size="sm" onClick={() => removeNeutralCompensator(compensator.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <CardDescription>
            Nœud: {node?.name || compensator.nodeId}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!eligible && <div className="bg-muted/50 p-2 rounded text-xs space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-3 w-3 text-yellow-500" />
                <span>Disponible uniquement sur réseau 400V, monophasé (PN) et en mode déséquilibré.</span>
              </div>
              <div className="grid grid-cols-1 gap-1">
                <div>• Réseau 400V: {is400V ? 'OK' : 'Non'}</div>
                <div>• Nœud en MONO 230V (PN): {isMonoPN ? 'OK' : nodeConnectionType || 'Non'}</div>
                <div>• Mode déséquilibré: {currentProject.loadModel === 'monophase_reparti' ? `OK (${currentProject.desequilibrePourcent || 0}%)` : 'Non'}</div>
              </div>
              <div className="flex items-center gap-2 flex-wrap pt-1">
                {!isMonoPN && node && <Button size="sm" variant="outline" onClick={() => updateProjectConfig({
              loadModel: 'monophase_reparti'
            })}>
                    Activer le mode monophasé réparti
                  </Button>}
                {currentProject.loadModel !== 'monophase_reparti' && <Button size="sm" variant="outline" onClick={() => updateProjectConfig({
              loadModel: 'monophase_reparti'
            })}>
                    Activer le mode déséquilibré
                  </Button>}
                {currentProject.loadModel === 'monophase_reparti' && (currentProject.desequilibrePourcent || 0) === 0 && <Button size="sm" variant="outline" onClick={() => updateProjectConfig({
              desequilibrePourcent: 10
            })}>
                    Déséquilibre 10%
                  </Button>}
              </div>
            </div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Puissance max (kVA)</Label>
              <Input type="number" value={compensator.maxPower_kVA} onChange={e => updateNeutralCompensator(compensator.id, {
              maxPower_kVA: Number(e.target.value)
            })} className="h-8" disabled={!eligible} />
            </div>
            <div>
              <Label className="text-xs">Seuil I_N (A)</Label>
              <Input type="number" value={compensator.tolerance_A} onChange={e => updateNeutralCompensator(compensator.id, {
              tolerance_A: Number(e.target.value)
            })} className="h-8" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Zph - Phase (Ω)</Label>
              <Input type="number" step="0.01" value={compensator.Zph_Ohm ?? 0.5} onChange={e => updateNeutralCompensator(compensator.id, {
              Zph_Ohm: Number(e.target.value)
            })} className="h-8" disabled={!eligible} />
              {compensator.Zph_Ohm < 0.15 && <p className="text-xs text-yellow-500 mt-1">⚠️ Doit être &gt; 0,15 Ω</p>}
            </div>
            <div>
              <Label className="text-xs">Zn - Neutre (Ω)</Label>
              <Input type="number" step="0.01" value={compensator.Zn_Ohm ?? 0.2} onChange={e => updateNeutralCompensator(compensator.id, {
              Zn_Ohm: Number(e.target.value)
            })} className="h-8" disabled={!eligible} />
              {compensator.Zn_Ohm < 0.15 && <p className="text-xs text-yellow-500 mt-1">⚠️ Doit être &gt; 0,15 Ω</p>}
            </div>
          </div>

          {compensator.currentIN_A !== undefined && <div className="bg-muted/50 p-2 rounded">
              <div className="text-xs font-medium mb-1">Résultats EQUI8:</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>I-EQUI8: {compensator.currentIN_A.toFixed(1)} A</div>
                <div>Réduction: {compensator.reductionPercent?.toFixed(1)}%</div>
              </div>
              <Separator className="my-2" />
              <div className="text-xs font-medium mb-1">Tensions (Ph-N):</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>Ph1: {compensator.u1p_V?.toFixed(1)} V</div>
                <div>Ph2: {compensator.u2p_V?.toFixed(1)} V</div>
                <div>Ph3: {compensator.u3p_V?.toFixed(1)} V</div>
              </div>
              {compensator.umoy_init_V && <>
                  <Separator className="my-2" />
                  <div className="text-xs">
                    <div>Umoy init: {compensator.umoy_init_V.toFixed(1)} V</div>
                    <div>Écart init: {compensator.ecart_init_V?.toFixed(1)} V</div>
                    <div>Écart EQUI8: {compensator.ecart_equi8_V?.toFixed(1)} V</div>
                  </div>
                </>}
              <Separator className="my-2" />
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>I_N initial: {compensator.iN_initial_A?.toFixed(1)} A</div>
                <div>I_N absorbé: {compensator.iN_absorbed_A?.toFixed(1)} A</div>
              </div>
              {compensator.compensationQ_kVAr && <div className="mt-2 text-xs">
                  <div>Q_A: {compensator.compensationQ_kVAr.A.toFixed(1)} kVAr</div>
                  <div>Q_B: {compensator.compensationQ_kVAr.B.toFixed(1)} kVAr</div>
                  <div>Q_C: {compensator.compensationQ_kVAr.C.toFixed(1)} kVAr</div>
                </div>}
              {compensator.isLimited && <div className="mt-2 flex items-center gap-1 text-xs text-yellow-600">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Limité par puissance max</span>
                </div>}
            </div>}
        </CardContent>
      </Card>;
  };
  const UpgradeCard = ({
    upgrade
  }: {
    upgrade: CableUpgrade;
  }) => {
    const cable = currentProject.cables.find(c => c.id === upgrade.originalCableId);
    const originalType = currentProject.cableTypes.find(t => t.id === cable?.typeId);
    const newType = currentProject.cableTypes.find(t => t.id === upgrade.newCableTypeId);
    return <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cable className="h-4 w-4 text-orange-500" />
              <CardTitle className="text-sm">
                {cable?.name || upgrade.originalCableId}
              </CardTitle>
            </div>
            <Badge variant={upgrade.reason === 'both' ? 'destructive' : upgrade.reason === 'voltage_drop' ? 'secondary' : 'default'}>
              {upgrade.reason === 'both' ? 'ΔU + Surcharge' : upgrade.reason === 'voltage_drop' ? 'Chute tension' : 'Surcharge'}
            </Badge>
          </div>
          <CardDescription>
            {originalType?.label} → {newType?.label}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="font-medium">Avant</div>
              <div>ΔU: {upgrade.before.voltageDropPercent.toFixed(1)}%</div>
              <div>I: {upgrade.before.current_A.toFixed(1)} A</div>
              <div>P: {upgrade.before.losses_kW.toFixed(2)} kW</div>
            </div>
            <div>
              <div className="font-medium">Après</div>
              <div>ΔU: {upgrade.after.voltageDropPercent.toFixed(1)}%</div>
              <div>I: {upgrade.after.current_A.toFixed(1)} A</div>
              <div>P: {upgrade.after.losses_kW.toFixed(2)} kW</div>
            </div>
            <div>
              <div className="font-medium">Amélioration</div>
              <div className="text-green-600">
                -{upgrade.improvement.voltageDropReduction.toFixed(1)}% ΔU
              </div>
              <div className="text-green-600">
                -{upgrade.improvement.lossReduction_kW.toFixed(2)} kW
              </div>
              {upgrade.after.estimatedCost && <div className="text-xs text-muted-foreground">
                  ~{upgrade.after.estimatedCost}€
                </div>}
            </div>
          </div>
        </CardContent>
      </Card>;
  };
  return <div className="fixed right-0 top-0 w-96 h-screen bg-background border-l shadow-lg overflow-hidden flex flex-col z-50">
      <div className="p-4 border-b bg-muted/50">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Module Simulation</h2>
          <Button variant="ghost" size="sm" onClick={closeEditPanel}>
            ×
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          <Tabs defaultValue="equi8" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="equi8">EQUI8</TabsTrigger>
              <TabsTrigger value="srg2">SRG2</TabsTrigger>
              <TabsTrigger value="doc">Documentation</TabsTrigger>
            </TabsList>

            <TabsContent value="equi8" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Compensateurs de neutre (EQUI8)</h3>
                <Button size="sm" onClick={() => {
                  // Trouver le premier nœud qui n'a pas encore de compensateur
                  const usedNodeIds = simulationEquipment.neutralCompensators.map(c => c.nodeId);
                  const availableNode = nodes.find(n => !usedNodeIds.includes(n.id));
                  if (availableNode) {
                    addNeutralCompensator(availableNode.id);
                  } else {
                    toast.error('Aucun nœud disponible pour ajouter un compensateur');
                  }
                }}>
                  <Plus className="h-3 w-3 mr-1" />
                  Ajouter
                </Button>
              </div>

              {simulationEquipment.neutralCompensators.length === 0 ? (
                <Card className="bg-muted/50">
                  <CardContent className="p-4 text-sm text-muted-foreground text-center">
                    Aucun compensateur configuré
                  </CardContent>
                </Card>
              ) : (
                simulationEquipment.neutralCompensators.map((comp) => (
                  <CompensatorCard key={comp.id} compensator={comp} />
                ))
              )}

              {simulationEquipment.cableUpgrades.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-medium mb-2">Propositions de renforcement</h3>
                    {simulationEquipment.cableUpgrades.map((upgrade) => (
                      <UpgradeCard key={upgrade.originalCableId} upgrade={upgrade} />
                    ))}
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="srg2" className="mt-4">
              <SRG2Panel />
            </TabsContent>

            <TabsContent value="doc" className="mt-4">
              <DocumentationPanel />
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>

      {simulationMode && <div className="p-4 border-t bg-muted/50">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Actions simulation</span>
              {currentResult?.convergenceStatus && <Badge variant={currentResult.convergenceStatus === 'converged' ? "default" : "destructive"}>
                  {currentResult.convergenceStatus === 'converged' ? 'Convergé' : 'Non convergé'}
                </Badge>}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => runSimulation()} className="flex-1">
                <Play className="h-3 w-3 mr-1" />
                Simuler
              </Button>
              <Button size="sm" variant="outline" onClick={() => toggleSimulationMode()}>
                <RotateCcw className="h-3 w-3 mr-1" />
                Réinitialiser
              </Button>
            </div>

            {baseline && currentResult && <div className="text-xs bg-background p-2 rounded border">
                <div className="grid grid-cols-2 gap-1">
                  <div>Baseline: {baseline.maxVoltageDropPercent.toFixed(1)}% ΔU</div>
                  <div>Simulation: {currentResult.maxVoltageDropPercent.toFixed(1)}% ΔU</div>
                  <div>Pertes baseline: {baseline.globalLosses_kW.toFixed(2)} kW</div>
                  <div>Pertes simulation: {currentResult.globalLosses_kW.toFixed(2)} kW</div>
                </div>
              </div>}
          </div>
        </div>}
    </div>;
};