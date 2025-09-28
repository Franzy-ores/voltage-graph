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
import { ForcedModePanel } from "@/components/ForcedModePanel";
import { PhaseDistributionSliders } from "@/components/PhaseDistributionSliders";
import { SRG2Panel } from "@/components/SRG2Panel";
import { 
  Settings, 
  TrendingUp, 
  Cable, 
  Play, 
  RotateCcw,
  Trash2,
  Plus,
  AlertTriangle,
  CheckCircle,
  Target,
  Activity
} from "lucide-react";

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

  const CompensatorCard = ({ compensator }: { compensator: NeutralCompensator }) => {
    const node = currentProject?.nodes.find(n => n.id === compensator.nodeId);
    const is400V = currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V';
    const nodeConnectionType = node && currentProject 
      ? getNodeConnectionType(currentProject.voltageSystem, currentProject.loadModel || 'polyphase_equilibre', node.isSource) 
      : null;
    const isMonoPN = nodeConnectionType === 'MONO_230V_PN';
    const hasDeseq = (currentProject?.loadModel ?? 'polyphase_equilibre') === 'monophase_reparti' && (currentProject?.desequilibrePourcent ?? 0) > 0;
    const eligible = is400V && isMonoPN && hasDeseq;
    
    return (
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-green-500" />
              <CardTitle className="text-sm">Compensateur de neutre</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={compensator.enabled}
                onCheckedChange={(enabled) => {
                  if (!eligible) return;
                  updateNeutralCompensator(compensator.id, { enabled });
                }}
                disabled={!eligible}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeNeutralCompensator(compensator.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <CardDescription>
            Nœud: {node?.name || compensator.nodeId}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!eligible && (
            <div className="bg-muted/50 p-2 rounded text-xs space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-3 w-3 text-yellow-500" />
                <span>Disponible uniquement sur réseau 400V, monophasé (PN) et en mode déséquilibré.</span>
              </div>
              <div className="grid grid-cols-1 gap-1">
                <div>• Réseau 400V: {is400V ? 'OK' : 'Non'}</div>
                <div>• Nœud en MONO 230V (PN): {isMonoPN ? 'OK' : (nodeConnectionType || 'Non')}</div>
                <div>• Mode déséquilibré: {(currentProject.loadModel === 'monophase_reparti') ? `OK (${currentProject.desequilibrePourcent || 0}%)` : 'Non'}</div>
              </div>
              <div className="flex items-center gap-2 flex-wrap pt-1">
                {!isMonoPN && node && (
                  <Button size="sm" variant="outline" onClick={() => updateProjectConfig({ loadModel: 'monophase_reparti' })}>
                    Activer le mode monophasé réparti
                  </Button>
                )}
                {currentProject.loadModel !== 'monophase_reparti' && (
                  <Button size="sm" variant="outline" onClick={() => updateProjectConfig({ loadModel: 'monophase_reparti' })}>
                    Activer le mode déséquilibré
                  </Button>
                )}
                {currentProject.loadModel === 'monophase_reparti' && ((currentProject.desequilibrePourcent || 0) === 0) && (
                  <Button size="sm" variant="outline" onClick={() => updateProjectConfig({ desequilibrePourcent: 10 })}>
                    Déséquilibre 10%
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Puissance max (kVA)</Label>
              <Input
                type="number"
                value={compensator.maxPower_kVA}
                onChange={(e) => updateNeutralCompensator(compensator.id, {
                  maxPower_kVA: Number(e.target.value)
                })}
                className="h-8"
                disabled={!eligible}
              />
            </div>
            <div>
              <Label className="text-xs">Seuil I_N (A)</Label>
              <Input
                type="number"
                value={compensator.tolerance_A}
                onChange={(e) => updateNeutralCompensator(compensator.id, {
                  tolerance_A: Number(e.target.value)
                })}
                className="h-8"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Z_phase (Ω)</Label>
              <Input
                type="number"
                step="0.01"
                value={compensator.zPhase_Ohm ?? 0.5}
                onChange={(e) => updateNeutralCompensator(compensator.id, {
                  zPhase_Ohm: Number(e.target.value)
                })}
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Z_neutre (Ω)</Label>
              <Input
                type="number"
                step="0.01"
                value={compensator.zNeutral_Ohm ?? 0.2}
                onChange={(e) => updateNeutralCompensator(compensator.id, {
                  zNeutral_Ohm: Number(e.target.value)
                })}
                className="h-8"
              />
            </div>
          </div>

          {compensator.currentIN_A !== undefined && (
            <div className="bg-muted/50 p-2 rounded">
              <div className="text-xs font-medium mb-1">Résultats simulation:</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>I_N après: {compensator.currentIN_A.toFixed(1)} A</div>
                <div>Réduction: {compensator.reductionPercent?.toFixed(1)}%</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs mt-2">
                <div>U1': {compensator.u1p_V?.toFixed(1)} V</div>
                <div>U2': {compensator.u2p_V?.toFixed(1)} V</div>
                <div>U3': {compensator.u3p_V?.toFixed(1)} V</div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                <div>I_N initial: {compensator.iN_initial_A?.toFixed(1)} A</div>
                <div>I_N absorbé: {compensator.iN_absorbed_A?.toFixed(1)} A</div>
              </div>
              {compensator.compensationQ_kVAr && (
                <div className="mt-2 text-xs">
                  <div>Q_A: {compensator.compensationQ_kVAr.A.toFixed(1)} kVAr</div>
                  <div>Q_B: {compensator.compensationQ_kVAr.B.toFixed(1)} kVAr</div>
                  <div>Q_C: {compensator.compensationQ_kVAr.C.toFixed(1)} kVAr</div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const UpgradeCard = ({ upgrade }: { upgrade: CableUpgrade }) => {
    const cable = currentProject.cables.find(c => c.id === upgrade.originalCableId);
    const originalType = currentProject.cableTypes.find(t => t.id === cable?.typeId);
    const newType = currentProject.cableTypes.find(t => t.id === upgrade.newCableTypeId);
    
    return (
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cable className="h-4 w-4 text-orange-500" />
              <CardTitle className="text-sm">
                {cable?.name || upgrade.originalCableId}
              </CardTitle>
            </div>
            <Badge variant={
              upgrade.reason === 'both' ? 'destructive' :
              upgrade.reason === 'voltage_drop' ? 'secondary' : 'default'
            }>
              {upgrade.reason === 'both' ? 'ΔU + Surcharge' :
               upgrade.reason === 'voltage_drop' ? 'Chute tension' : 'Surcharge'}
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
              {upgrade.after.estimatedCost && (
                <div className="text-xs text-muted-foreground">
                  ~{upgrade.after.estimatedCost}€
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="fixed right-0 top-0 w-96 h-screen bg-background border-l shadow-lg overflow-hidden flex flex-col z-50">
      <div className="p-4 border-b bg-muted/50">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Module Simulation</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={closeEditPanel}
          >
            ×
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={simulationMode}
            onCheckedChange={toggleSimulationMode}
          />
          <span className="text-sm">Mode simulation</span>
          <Badge variant={simulationMode ? "default" : "secondary"}>
            {simulationMode ? "Actif" : "Inactif"}
          </Badge>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          <Tabs defaultValue="calibration" className="w-full">
            <TabsList className="grid w-full grid-cols-4 text-xs">
              <TabsTrigger value="calibration" className="text-xs">
                <Target className="h-3 w-3 mr-1" />
                Calibration
              </TabsTrigger>
              <TabsTrigger value="srg2" className="text-xs">
                <Activity className="h-3 w-3 mr-1" />
                SRG2
              </TabsTrigger>
              <TabsTrigger value="compensators" className="text-xs">
                <Settings className="h-3 w-3 mr-1" />
                Neutre
              </TabsTrigger>
              <TabsTrigger value="upgrades" className="text-xs">
                <TrendingUp className="h-3 w-3 mr-1" />
                Câbles
              </TabsTrigger>
            </TabsList>

            <TabsContent value="calibration" className="mt-4">
              <ForcedModePanel />
            </TabsContent>

            <TabsContent value="srg2" className="mt-4">
              <SRG2Panel />
            </TabsContent>

            <TabsContent value="compensators" className="mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Compensateurs de neutre</h3>
                  <NodeSelector
                    nodes={currentProject.nodes}
                    onNodeSelected={(nodeId) => addNeutralCompensator(nodeId)}
                    title="Ajouter un compensateur de neutre"
                    description="Réduction du courant de neutre (EQUI8)"
                    trigger={
                      <Button size="sm" variant="outline" disabled={!nodes.length}>
                        <Plus className="h-3 w-3 mr-1" />
                        Ajouter
                      </Button>
                    }
                  />
                </div>

                {simulationEquipment.neutralCompensators.length === 0 ? (
                  <Card className="p-4 text-center text-muted-foreground">
                    <Settings className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Aucun compensateur</p>
                    <p className="text-xs">
                      Ajoutez des compensateurs pour réduire le courant de neutre
                    </p>
                  </Card>
                ) : (
                  simulationEquipment.neutralCompensators.map(compensator => (
                    <CompensatorCard key={compensator.id} compensator={compensator} />
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent value="upgrades" className="mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Renforcements de câbles</h3>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => proposeCableUpgrades()}
                    disabled={!simulationMode}
                  >
                    <TrendingUp className="h-3 w-3 mr-1" />
                    Analyser
                  </Button>
                </div>

                {!simulationMode && (
                  <Card className="p-4 bg-muted/50">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <AlertTriangle className="h-4 w-4" />
                      Activez le mode simulation pour analyser les renforcements
                    </div>
                  </Card>
                )}

                {simulationEquipment.cableUpgrades.length === 0 ? (
                  <Card className="p-4 text-center text-muted-foreground">
                    <Cable className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Aucun renforcement proposé</p>
                    <p className="text-xs">
                      Analysez le réseau pour identifier les améliorations
                    </p>
                  </Card>
                ) : (
                  simulationEquipment.cableUpgrades.map((upgrade, index) => (
                    <UpgradeCard key={index} upgrade={upgrade} />
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>

      {simulationMode && (
        <div className="p-4 border-t bg-muted/50">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Actions simulation</span>
              {currentResult?.convergenceStatus && (
                <Badge variant={currentResult.convergenceStatus === 'converged' ? "default" : "destructive"}>
                  {currentResult.convergenceStatus === 'converged' ? 'Convergé' : 'Non convergé'}
                </Badge>
              )}
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

            {baseline && currentResult && (
              <div className="text-xs bg-background p-2 rounded border">
                <div className="grid grid-cols-2 gap-1">
                  <div>Baseline: {baseline.maxVoltageDropPercent.toFixed(1)}% ΔU</div>
                  <div>Simulation: {currentResult.maxVoltageDropPercent.toFixed(1)}% ΔU</div>
                  <div>Pertes baseline: {baseline.globalLosses_kW.toFixed(2)} kW</div>
                  <div>Pertes simulation: {currentResult.globalLosses_kW.toFixed(2)} kW</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};