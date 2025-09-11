import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useNetworkStore } from "@/store/networkStore";
import { Zap, AlertTriangle, CheckCircle2, Save, Calculator } from "lucide-react";

export const ForcedModePanel = () => {
  const {
    currentProject,
    selectedScenario,
    updateProjectConfig,
    runSimulation,
    updateAllCalculations,
    simulationResults
  } = useNetworkStore();

  const [localConfig, setLocalConfig] = useState({
    U1: currentProject.forcedModeConfig?.measuredVoltages.U1 || 225,
    U2: currentProject.forcedModeConfig?.measuredVoltages.U2 || 230,
    U3: currentProject.forcedModeConfig?.measuredVoltages.U3 || 228,
    measurementNodeId: currentProject.forcedModeConfig?.measurementNodeId || "",
    targetVoltage: currentProject.forcedModeConfig?.targetVoltage || 0,
    dayU1: currentProject.forcedModeConfig?.dayVoltages?.U1 || 225,
    dayU2: currentProject.forcedModeConfig?.dayVoltages?.U2 || 230,
    dayU3: currentProject.forcedModeConfig?.dayVoltages?.U3 || 228
  });

  // État local pour stocker les résultats de simulation
  const [simulationResults_local, setSimulationResults_local] = useState<any>(null);

  // Early return after hooks
  if (!currentProject) return null;

  // Calculer automatiquement le déséquilibre
  const calculateImbalancePercent = () => {
    const { U1, U2, U3 } = localConfig;
    const U_moy = (U1 + U2 + U3) / 3;
    const U_dev_max = Math.max(
      Math.abs(U1 - U_moy),
      Math.abs(U2 - U_moy),
      Math.abs(U3 - U_moy)
    );
    return (U_dev_max / U_moy) * 100;
  };

  const isForcedMode = selectedScenario === 'FORCÉ';
  const nonSourceNodes = currentProject.nodes.filter(n => !n.isSource);
  const imbalancePercent = calculateImbalancePercent();

  const runForcedSimulation = async () => {
    const calculatedImbalance = calculateImbalancePercent();
    
    // Mettre à jour la configuration du projet
    updateProjectConfig({
      forcedModeConfig: {
        measuredVoltages: {
          U1: localConfig.U1,
          U2: localConfig.U2,
          U3: localConfig.U3
        },
        measurementNodeId: localConfig.measurementNodeId,
        targetVoltage: localConfig.targetVoltage > 0 ? localConfig.targetVoltage : undefined,
        dayVoltages: {
          U1: localConfig.dayU1,
          U2: localConfig.dayU2,
          U3: localConfig.dayU3
        }
      },
      desequilibrePourcent: calculatedImbalance
    });

    // Déclencher les calculs normaux ET la simulation
    updateAllCalculations();
    runSimulation();
    
    // Récupérer les résultats après simulation
    setTimeout(() => {
      const simResult = simulationResults['FORCÉ'];
      if (simResult) {
        setSimulationResults_local(simResult);
      }
    }, 100);
  };

  const saveSimulationResults = () => {
    if (!simulationResults_local) return;
    
    // Sauvegarder les pourcentages finaux dans le projet
    updateProjectConfig({
      manualPhaseDistribution: {
        charges: simulationResults_local.finalLoadDistribution || {A: 33.33, B: 33.33, C: 33.33},
        productions: simulationResults_local.finalProductionDistribution || {A: 33.33, B: 33.33, C: 33.33},
        constraints: {min: 10, max: 80, total: 100}
      },
      foisonnementCharges: simulationResults_local.calibratedFoisonnementCharges || currentProject.foisonnementCharges
    });
    
    // Réinitialiser les résultats locaux après sauvegarde
    setSimulationResults_local(null);
  };

  return (
    <Card className={`mb-4 ${isForcedMode ? 'border-orange-200 bg-orange-50/30' : 'opacity-50'}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-orange-500" />
          <CardTitle className="text-sm">Mode Forcé - Calibrage par mesures</CardTitle>
          <Badge variant={isForcedMode ? "default" : "secondary"}>
            {isForcedMode ? "Actif" : "Inactif"}
          </Badge>
        </div>
        <CardDescription>
          Saisissez 3 mesures de tension réelles pour ajuster automatiquement le déséquilibre
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {!isForcedMode && (
          <div className="bg-muted/50 p-3 rounded-md text-xs flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <span>Sélectionnez le scénario "FORCÉ" pour utiliser cette fonctionnalité</span>
          </div>
        )}

        {/* Sélection du nœud de mesure */}
        <div>
          <Label className="text-xs font-medium">Nœud de mesure</Label>
          <Select
            value={localConfig.measurementNodeId}
            onValueChange={(value) => setLocalConfig({ ...localConfig, measurementNodeId: value })}
            disabled={!isForcedMode}
          >
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Choisir le nœud où les mesures ont été prises" />
            </SelectTrigger>
            <SelectContent>
              {nonSourceNodes.map((node) => (
                <SelectItem key={node.id} value={node.id}>
                  {node.name} ({node.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Phase 1: Calibration (tension cible) */}
        <div className="space-y-2">
          <Label className="text-xs font-medium">Phase 1 - Calibration du foisonnement (nuit)</Label>
          <div>
            <Label className="text-xs text-muted-foreground">Tension cible (V) - 0 = pas de calibration</Label>
            <Input
              type="number"
              value={localConfig.targetVoltage}
              onChange={(e) => setLocalConfig({ ...localConfig, targetVoltage: Number(e.target.value) })}
              className="h-8"
              disabled={!isForcedMode}
              min={0}
              max={250}
              placeholder="0 pour utiliser le foisonnement manuel"
            />
          </div>
        </div>

        {/* Phase 2: Tensions de jour */}
        <div className="space-y-2">
          <Label className="text-xs font-medium">Phase 2 - Tensions de jour pour répartition des phases</Label>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">U1 jour (V)</Label>
              <Input
                type="number"
                value={localConfig.dayU1}
                onChange={(e) => setLocalConfig({ ...localConfig, dayU1: Number(e.target.value) })}
                className="h-8"
                disabled={!isForcedMode}
                min={180}
                max={250}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">U2 jour (V)</Label>
              <Input
                type="number"
                value={localConfig.dayU2}
                onChange={(e) => setLocalConfig({ ...localConfig, dayU2: Number(e.target.value) })}
                className="h-8"
                disabled={!isForcedMode}
                min={180}
                max={250}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">U3 jour (V)</Label>
              <Input
                type="number"
                value={localConfig.dayU3}
                onChange={(e) => setLocalConfig({ ...localConfig, dayU3: Number(e.target.value) })}
                className="h-8"
                disabled={!isForcedMode}
                min={180}
                max={250}
              />
            </div>
          </div>
        </div>

        {/* Tensions mesurées */}
        <div>
          <Label className="text-xs font-medium mb-2 block">Tensions mesurées (V)</Label>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">U1 (V)</Label>
              <Input
                type="number"
                value={localConfig.U1}
                onChange={(e) => setLocalConfig({ ...localConfig, U1: Number(e.target.value) })}
                className="h-8"
                disabled={!isForcedMode}
                min={180}
                max={250}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">U2 (V)</Label>
              <Input
                type="number"
                value={localConfig.U2}
                onChange={(e) => setLocalConfig({ ...localConfig, U2: Number(e.target.value) })}
                className="h-8"
                disabled={!isForcedMode}
                min={180}
                max={250}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">U3 (V)</Label>
              <Input
                type="number"
                value={localConfig.U3}
                onChange={(e) => setLocalConfig({ ...localConfig, U3: Number(e.target.value) })}
                className="h-8"
                disabled={!isForcedMode}
                min={180}
                max={250}
              />
            </div>
          </div>
        </div>

        {/* Calcul automatique */}
        <div className="bg-muted/50 p-3 rounded-md space-y-2">
          <div className="text-xs font-medium">Calcul automatique du déséquilibre :</div>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <div className="text-muted-foreground">Tension moyenne :</div>
              <div className="font-mono">{((localConfig.U1 + localConfig.U2 + localConfig.U3) / 3).toFixed(1)} V</div>
            </div>
            <div>
              <div className="text-muted-foreground">Déséquilibre calculé :</div>
              <div className="font-mono font-semibold text-orange-600">
                {imbalancePercent.toFixed(2)}%
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Écart maximal : {Math.max(
              Math.abs(localConfig.U1 - (localConfig.U1 + localConfig.U2 + localConfig.U3) / 3),
              Math.abs(localConfig.U2 - (localConfig.U1 + localConfig.U2 + localConfig.U3) / 3),
              Math.abs(localConfig.U3 - (localConfig.U1 + localConfig.U2 + localConfig.U3) / 3)
            ).toFixed(1)} V
          </div>
        </div>

        {/* Résultats de simulation */}
        {simulationResults_local && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-blue-500" />
                <Label className="text-sm font-medium">Résultats de la simulation</Label>
              </div>
              
              {/* Statut de convergence */}
              <div className={`p-3 rounded-md flex items-center gap-2 ${
                simulationResults_local.convergenceStatus === 'converged' 
                  ? 'bg-green-50 text-green-700' 
                  : 'bg-red-50 text-red-700'
              }`}>
                {simulationResults_local.convergenceStatus === 'converged' ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="text-sm font-medium">Simulation du réseau stabilisée</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">ATTENTION : Le simulateur n'a pas réussi à converger</span>
                  </>
                )}
              </div>

              {/* Répartition finale des charges */}
              {simulationResults_local.finalLoadDistribution && (
                <div className="bg-muted/50 p-3 rounded-md">
                  <div className="text-xs font-medium mb-2">Répartition finale des charges :</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>Phase A: {simulationResults_local.finalLoadDistribution.A.toFixed(1)}%</div>
                    <div>Phase B: {simulationResults_local.finalLoadDistribution.B.toFixed(1)}%</div>
                    <div>Phase C: {simulationResults_local.finalLoadDistribution.C.toFixed(1)}%</div>
                  </div>
                </div>
              )}

              {/* Répartition finale des productions */}
              {simulationResults_local.finalProductionDistribution && (
                <div className="bg-muted/50 p-3 rounded-md">
                  <div className="text-xs font-medium mb-2">Répartition finale des productions :</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>Phase A: {simulationResults_local.finalProductionDistribution.A.toFixed(1)}%</div>
                    <div>Phase B: {simulationResults_local.finalProductionDistribution.B.toFixed(1)}%</div>
                    <div>Phase C: {simulationResults_local.finalProductionDistribution.C.toFixed(1)}%</div>
                  </div>
                </div>
              )}

              {/* Foisonnement calibré */}
              {simulationResults_local.calibratedFoisonnementCharges && (
                <div className="bg-muted/50 p-3 rounded-md">
                  <div className="text-xs font-medium mb-1">Foisonnement calibré :</div>
                  <div className="text-xs">{simulationResults_local.calibratedFoisonnementCharges.toFixed(1)}%</div>
                </div>
              )}

              {/* Bouton de sauvegarde */}
              {simulationResults_local.convergenceStatus === 'converged' && (
                <Button
                  onClick={saveSimulationResults}
                  className="w-full"
                  variant="default"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Sauvegarder les résultats dans le projet
                </Button>
              )}
            </div>
          </>
        )}

        {/* Action de simulation */}
        {isForcedMode && !simulationResults_local && (
          <Button
            onClick={runForcedSimulation}
            className="w-full"
            disabled={!localConfig.measurementNodeId || nonSourceNodes.length === 0}
          >
            <Calculator className="h-4 w-4 mr-2" />
            Lancer la simulation
          </Button>
        )}

        {/* Nouvelle simulation */}
        {isForcedMode && simulationResults_local && (
          <Button
            onClick={() => setSimulationResults_local(null)}
            className="w-full"
            variant="outline"
          >
            <Calculator className="h-4 w-4 mr-2" />
            Nouvelle simulation
          </Button>
        )}
      </CardContent>
    </Card>
  );
};