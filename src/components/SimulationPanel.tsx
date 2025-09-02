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
import { VoltageRegulator, NeutralCompensator, CableUpgrade } from "@/types/network";
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
  CheckCircle
} from "lucide-react";

export const SimulationPanel = () => {
  const {
    currentProject,
    simulationMode,
    simulationEquipment,
    simulationResults,
    selectedScenario,
    toggleSimulationMode,
    addVoltageRegulator,
    removeVoltageRegulator,
    updateVoltageRegulator,
    addNeutralCompensator,
    removeNeutralCompensator,
    updateNeutralCompensator,
    proposeCableUpgrades,
    runSimulation,
    closeEditPanel
  } = useNetworkStore();

  if (!currentProject) return null;

  const nodes = currentProject.nodes.filter(n => !n.isSource);
  const currentResult = simulationResults[selectedScenario];
  const baseline = currentResult?.baselineResult;

  const RegulatorCard = ({ regulator }: { regulator: VoltageRegulator }) => {
    const node = currentProject.nodes.find(n => n.id === regulator.nodeId);
    
    return (
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-blue-500" />
              <CardTitle className="text-sm">
                Armoire {regulator.type.replace('_', ' - ')}
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={regulator.enabled}
                onCheckedChange={(enabled) => 
                  updateVoltageRegulator(regulator.id, { enabled })
                }
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeVoltageRegulator(regulator.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <CardDescription>
            Nœud: {node?.name || regulator.nodeId}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tension cible (V)</Label>
              <Input
                type="number"
                value={regulator.targetVoltage_V}
                onChange={(e) => updateVoltageRegulator(regulator.id, {
                  targetVoltage_V: Number(e.target.value)
                })}
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Puissance max (kVA)</Label>
              <Input
                type="number"
                value={regulator.maxPower_kVA}
                onChange={(e) => updateVoltageRegulator(regulator.id, {
                  maxPower_kVA: Number(e.target.value)
                })}
                className="h-8"
                disabled
              />
            </div>
          </div>
          
          {regulator.currentQ_kVAr !== undefined && (
            <div className="bg-muted/50 p-2 rounded">
              <div className="text-xs font-medium mb-1">Résultats simulation:</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Q injecté: {regulator.currentQ_kVAr.toFixed(1)} kVAr</div>
                <div>Tension: {regulator.currentVoltage_V?.toFixed(1)} V</div>
              </div>
              {regulator.isLimited && (
                <Badge variant="destructive" className="mt-1 text-xs">
                  Puissance limitée
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const CompensatorCard = ({ compensator }: { compensator: NeutralCompensator }) => {
    const node = currentProject.nodes.find(n => n.id === compensator.nodeId);
    
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
                onCheckedChange={(enabled) => 
                  updateNeutralCompensator(compensator.id, { enabled })
                }
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

          {compensator.currentIN_A !== undefined && (
            <div className="bg-muted/50 p-2 rounded">
              <div className="text-xs font-medium mb-1">Résultats simulation:</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>I_N: {compensator.currentIN_A.toFixed(1)} A</div>
                <div>Réduction: {compensator.reductionPercent?.toFixed(1)}%</div>
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
    <div className="w-96 bg-background border-l shadow-lg overflow-hidden flex flex-col">
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
          <Tabs defaultValue="regulators" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
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

            <TabsContent value="regulators" className="mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Armoires de régulation</h3>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => addVoltageRegulator(nodes[0]?.id || '', '230V')}
                      disabled={!nodes.length}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      230V
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => addVoltageRegulator(nodes[0]?.id || '', '400V')}
                      disabled={!nodes.length}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      400V
                    </Button>
                  </div>
                </div>

                {simulationEquipment.regulators.length === 0 ? (
                  <Card className="p-4 text-center text-muted-foreground">
                    <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Aucune armoire de régulation</p>
                    <p className="text-xs">
                      Ajoutez des armoires pour maintenir la tension
                    </p>
                  </Card>
                ) : (
                  simulationEquipment.regulators.map(regulator => (
                    <RegulatorCard key={regulator.id} regulator={regulator} />
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent value="compensators" className="mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Compensateurs de neutre</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => addNeutralCompensator(nodes[0]?.id || '')}
                    disabled={!nodes.length}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Ajouter
                  </Button>
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
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Renforcement des câbles</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={proposeCableUpgrades}
                  >
                    <TrendingUp className="h-3 w-3 mr-1" />
                    Analyser
                  </Button>
                </div>

                {simulationEquipment.cableUpgrades.length === 0 ? (
                  <Card className="p-4 text-center text-muted-foreground">
                    <Cable className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Aucune amélioration proposée</p>
                    <p className="text-xs">
                      Analysez le réseau pour des propositions
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

      <div className="p-4 border-t bg-muted/50">
        <div className="space-y-3">
          <Separator />
          
          {currentResult && baseline && (
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