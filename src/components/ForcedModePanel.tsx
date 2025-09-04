import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useNetworkStore } from "@/store/networkStore";
import { Zap, AlertTriangle, CheckCircle2 } from "lucide-react";

export const ForcedModePanel = () => {
  const {
    currentProject,
    selectedScenario,
    updateProjectConfig,
    runSimulation
  } = useNetworkStore();

  if (!currentProject) return null;

  const [localConfig, setLocalConfig] = useState({
    U1: currentProject.forcedModeConfig?.measuredVoltages.U1 || 225,
    U2: currentProject.forcedModeConfig?.measuredVoltages.U2 || 230,
    U3: currentProject.forcedModeConfig?.measuredVoltages.U3 || 228,
    measurementNodeId: currentProject.forcedModeConfig?.measurementNodeId || ""
  });

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

  const applyForcedMode = () => {
    const calculatedImbalance = calculateImbalancePercent();
    
    // Mettre à jour la configuration du projet
    updateProjectConfig({
      forcedModeConfig: {
        measuredVoltages: {
          U1: localConfig.U1,
          U2: localConfig.U2,
          U3: localConfig.U3
        },
        measurementNodeId: localConfig.measurementNodeId
      },
      desequilibrePourcent: calculatedImbalance
    });

    // Déclencher la simulation
    runSimulation();
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

        {/* Action */}
        {isForcedMode && (
          <Button
            onClick={applyForcedMode}
            className="w-full"
            disabled={!localConfig.measurementNodeId || nonSourceNodes.length === 0}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Appliquer le mode forcé
          </Button>
        )}
      </CardContent>
    </Card>
  );
};