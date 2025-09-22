import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNetworkStore } from "@/store/networkStore";
import { SRG2Config, NeutralCompensator, CableUpgrade } from "@/types/network";
import { NodeSelector } from "@/components/NodeSelector";
import { getNodeConnectionType } from '@/utils/nodeConnectionType';
import { ForcedModePanel } from "@/components/ForcedModePanel";
import { PhaseDistributionSliders } from "@/components/PhaseDistributionSliders";
import { 
  Zap, 
  Settings, 
  TrendingUp, 
  Cable, 
  Play, 
  RotateCcw,
  Trash2,
  Plus,
  AlertTriangle,
  CheckCircle,
  Target
} from "lucide-react";

export const SimulationPanel = () => {
  const {
    currentProject,
    simulationMode,
    simulationEquipment,
    simulationResults,
    selectedScenario,
    toggleSimulationMode,
    addSRG2Regulator,
    removeSRG2Regulator,
    updateSRG2Config,
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

  const SRG2Card = ({ srg2Config }: { srg2Config: SRG2Config }) => {
    const node = currentProject.nodes.find(n => n.id === srg2Config.nodeId);
    const srg2Result = currentResult?.srg2Result;
    
    return (
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-blue-500" />
              <CardTitle className="text-sm">
                Régulateur SRG2
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={srg2Config.enabled}
                onCheckedChange={(enabled) => {
                  updateSRG2Config({ enabled });
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeSRG2Regulator()}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <CardDescription>
            Nœud: {node?.name || srg2Config.nodeId}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="networkType" className="text-xs text-muted-foreground">
                  Type de réseau
                </Label>
                <Select
                  value={srg2Config.networkType}
                  onValueChange={(value: '230V' | '400V') => {
                    updateSRG2Config({ networkType: value });
                  }}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="230V">230V</SelectItem>
                    <SelectItem value="400V">400V</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  État
                </Label>
                <div className="flex gap-1 mt-1">
                  {srg2Result && (
                    <Badge 
                      variant={srg2Result.isActive ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {srg2Result.state || 'OFF'}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="maxInjection" className="text-xs text-muted-foreground">
                  Puissance max injection (kVA)
                </Label>
                <Input
                  id="maxInjection"
                  type="number"
                  value={srg2Config.maxPowerInjection_kVA}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    if (!isNaN(value) && value >= 0) {
                      updateSRG2Config({ maxPowerInjection_kVA: value });
                    }
                  }}
                  className="h-8"
                  min="0"
                  step="1"
                />
              </div>
              <div>
                <Label htmlFor="maxConsumption" className="text-xs text-muted-foreground">
                  Puissance max consommation (kVA)
                </Label>
                <Input
                  id="maxConsumption"
                  type="number"
                  value={srg2Config.maxPowerConsumption_kVA}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    if (!isNaN(value) && value >= 0) {
                      updateSRG2Config({ maxPowerConsumption_kVA: value });
                    }
                  }}
                  className="h-8"
                  min="0"
                  step="1"
                />
              </div>
            </div>

            {srg2Result && srg2Config.enabled && (
              <div className="mt-3 p-3 bg-muted/50 rounded-md">
                <div className="text-xs font-medium mb-2">Résultats SRG2:</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {srg2Result.ratio && (
                    <div>
                      <span className="text-muted-foreground">Ratio:</span>
                      <span className="ml-1 font-mono">{srg2Result.ratio.toFixed(3)}</span>
                    </div>
                  )}
                  {srg2Result.regulatedVoltage && (
                      <div>
                        <span className="text-muted-foreground">Tensions:</span>
                        <div className="ml-1 font-mono text-xs">
                          Originale: {srg2Result.originalVoltage?.toFixed(1)}V<br/>
                          Régulée: {srg2Result.regulatedVoltage?.toFixed(1)}V<br/>
                          Ratio: {srg2Result.ratio?.toFixed(3)}
                        </div>
                      </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

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
              <TabsTrigger value="regulators" className="text-xs">
                <Zap className="h-3 w-3 mr-1" />
                Régulation
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

            <TabsContent value="regulators" className="mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Régulateur SRG2</h3>
                  {!simulationEquipment.srg2 && (
                    <NodeSelector
                      nodes={nodes}
                      onNodeSelected={(nodeId) => addSRG2Regulator(nodeId)}
                      title="Ajouter un régulateur SRG2"
                      description="Sélectionnez le nœud où installer le régulateur SRG2"
                      trigger={
                        <Button size="sm" variant="outline" disabled={!nodes.length}>
                          <Plus className="h-3 w-3 mr-1" />
                          Ajouter
                        </Button>
                      }
                    />
                  )}
                </div>

                {!simulationEquipment.srg2 ? (
                  <Card className="p-4 text-center text-muted-foreground">
                    <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Aucun régulateur SRG2</p>
                    <p className="text-xs">
                      Ajoutez un régulateur SRG2 pour la régulation automatique
                    </p>
                  </Card>
                ) : (
                  <SRG2Card srg2Config={simulationEquipment.srg2} />
                )}
              </div>
            </TabsContent>

            <TabsContent value="compensators" className="mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Compensateurs de neutre</h3>
                  <NodeSelector
                    nodes={currentProject.nodes}
                    onNodeSelected={(nodeId) => addNeutralCompensator(nodeId)}
                    title="Ajouter un compensateur de neutre"
                    description="Sélectionnez le nœud où installer le compensateur"
                  />
                </div>

                {simulationEquipment.neutralCompensators.length === 0 ? (
                  <Card className="p-4 text-center text-muted-foreground">
                    <Settings className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Aucun compensateur de neutre</p>
                    <p className="text-xs">
                      Ajoutez des compensateurs pour réduire I_N
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
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Renforcement des câbles</h3>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Label className="text-xs">Seuil ΔU:</Label>
                        <Input
                          type="number"
                          min="1"
                          max="15"
                          step="0.1"
                          defaultValue="8"
                          className="h-7 w-16 text-xs"
                          id="voltage-threshold"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const threshold = parseFloat((document.getElementById('voltage-threshold') as HTMLInputElement)?.value || '8');
                          proposeCableUpgrades(threshold);
                        }}
                        className="flex items-center gap-1"
                      >
                        <TrendingUp className="h-3 w-3" />
                        Analyser
                      </Button>
                    </div>
                  </div>
                </div>

                {simulationEquipment.cableUpgrades.length === 0 ? (
                  <Card className="p-4 text-center text-muted-foreground">
                    <Cable className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Aucune amélioration proposée</p>
                    <p className="text-xs">
                      Réglez le seuil et cliquez sur "Analyser" pour détecter les circuits avec chute de tension excessive
                    </p>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => {
                          if (!simulationMode) {
                            // Activer le mode simulation
                            toggleSimulationMode();
                          }
                          // Lancer la simulation avec les remplacements proposés
                          runSimulation();
                        }}
                        className="flex items-center gap-1"
                      >
                        <CheckCircle className="h-3 w-3" />
                        Appliquer ces remplacements
                      </Button>
                    </div>
                    {simulationEquipment.cableUpgrades.map((upgrade, index) => (
                      <UpgradeCard key={index} upgrade={upgrade} />
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>

      <div className="p-4 border-t bg-muted/50">
        <div className="space-y-3">
          <Separator />
          
          {currentResult && baseline && (
            <>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="font-medium text-muted-foreground">Baseline</div>
                  <div>Pertes: {baseline.globalLosses_kW.toFixed(2)} kW</div>
                  <div>ΔU max: {baseline.maxVoltageDropPercent.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="font-medium text-green-600">Simulation</div>
                  <div>Pertes: {currentResult.globalLosses_kW.toFixed(2)} kW</div>
                  <div>ΔU max: {currentResult.maxVoltageDropPercent.toFixed(1)}%</div>
                </div>
              </div>

              {simulationEquipment.cableUpgrades.length > 0 && (
                <div className="mt-4 p-3 bg-muted/30 rounded-md">
                  <div className="text-xs font-medium mb-2 flex items-center gap-2">
                    <Cable className="h-3 w-3 text-purple-600" />
                    Résumé des remplacements
                  </div>
                  
                  {/* Longueur totale remplacée */}
                  <div className="text-xs mb-2">
                    <span className="font-medium">Longueur totale à remplacer:</span> {
                      simulationEquipment.cableUpgrades.reduce((total, upgrade) => {
                        const cable = currentProject.cables.find(c => c.id === upgrade.originalCableId);
                        return total + (cable?.length_m || 0);
                      }, 0).toFixed(0)
                    } mètres
                  </div>
                  
                  {/* Détails des remplacements */}
                  <div className="space-y-1 text-xs">
                    {simulationEquipment.cableUpgrades.map((upgrade, index) => {
                      const cable = currentProject.cables.find(c => c.id === upgrade.originalCableId);
                      const originalType = currentProject.cableTypes.find(t => t.id === cable?.typeId);
                      const newType = currentProject.cableTypes.find(t => t.id === upgrade.newCableTypeId);
                      
                      return (
                        <div key={index} className="text-muted-foreground">
                          Remplacement du tronçon '{upgrade.originalCableId}' : 
                          câble {originalType?.label || 'inconnu'} par {newType?.label || 'inconnu'}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="flex gap-2">
            <Button
              onClick={runSimulation}
              className="flex-1"
              disabled={!simulationMode}
            >
              <Play className="h-4 w-4 mr-2" />
              Simuler
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                // Reset simulation
                // Cette fonctionnalité peut être ajoutée plus tard
              }}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
