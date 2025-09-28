import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useNetworkStore } from "@/store/networkStore";
import { SimulationCalculator } from "@/utils/simulationCalculator";
import { toast } from "sonner";
import { Zap, AlertTriangle, CheckCircle2, Save, Calculator } from "lucide-react";

export const ForcedModePanel = () => {
  const {
    currentProject,
    selectedScenario,
    updateProjectConfig,
    runSimulation,
    updateAllCalculations,
    simulationResults,
    updateSimulationPreview,
    clearSimulationPreview
  } = useNetworkStore();

  // Écouter les mises à jour de foisonnement depuis la simulation
  useEffect(() => {
      // Écouter les mises à jour de foisonnement depuis la simulation
      const handleFoisonnementUpdate = (event: CustomEvent) => {
        console.log('🔄 Réception mise à jour foisonnement:', event.detail);
        updateProjectConfig({
          foisonnementCharges: event.detail.foisonnementCharges
        });
        
        // Mettre à jour le foisonnement productions si spécifié
        if (event.detail.foisonnementProductions !== undefined) {
          updateProjectConfig({
            foisonnementProductions: event.detail.foisonnementProductions
          });
        }
        
        // Mettre à jour les répartitions si disponibles
        if (event.detail.finalDistribution) {
          updateProjectConfig({
            manualPhaseDistribution: event.detail.finalDistribution
          });
          console.log('🔄 Répartitions des phases mises à jour:', event.detail.finalDistribution);
        }
        
        // Maintenir la modifiabilité des curseurs après simulation
        if (event.detail.keepSliderEnabled) {
          console.log('🔄 Curseurs maintenus modifiables après simulation');
        }
      };

    window.addEventListener('updateProjectFoisonnement', handleFoisonnementUpdate as EventListener);
    return () => {
      window.removeEventListener('updateProjectFoisonnement', handleFoisonnementUpdate as EventListener);
    };
  }, [updateProjectConfig]);

  const [localConfig, setLocalConfig] = useState({
    U1: currentProject.forcedModeConfig?.measuredVoltages.U1 || 225,
    U2: currentProject.forcedModeConfig?.measuredVoltages.U2 || 230,
    U3: currentProject.forcedModeConfig?.measuredVoltages.U3 || 228,
    measurementNodeId: currentProject.forcedModeConfig?.measurementNodeId || "",
    targetVoltage: currentProject.forcedModeConfig?.targetVoltage || 0
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
    if (!currentProject || !localConfig.measurementNodeId) {
      toast.error("Configuration incomplète pour la simulation");
      return;
    }

    try {
      toast.info("Démarrage de la simulation forcée...");
      
      // Créer une instance du calculateur de simulation
      const calculator = new SimulationCalculator(currentProject.cosPhi);
      
      // Estimer la tension manquante en 230V si nécessaire
      let { U1, U2, U3 } = localConfig;
      if (currentProject.voltageSystem === 'TRIPHASÉ_230V') {
        // Logique d'estimation simple pour la 3ème tension
        const validVoltages = [U1, U2, U3].filter(v => v && v > 0);
        if (validVoltages.length === 2) {
          const averageMeasured = validVoltages.reduce((sum, v) => sum + v, 0) / validVoltages.length;
          const nominalVoltage = 230;
          
          if (!U1 || U1 <= 0) U1 = nominalVoltage + (nominalVoltage - averageMeasured);
          if (!U2 || U2 <= 0) U2 = nominalVoltage + (nominalVoltage - averageMeasured);
          if (!U3 || U3 <= 0) U3 = nominalVoltage + (nominalVoltage - averageMeasured);
          
          console.log(`📊 Tension manquante estimée: ${averageMeasured.toFixed(1)}V`);
        }
      }
      
      // Déterminer la tension source
      const sourceNode = currentProject.nodes.find(n => n.isSource);
      const sourceVoltage = localConfig.targetVoltage > 0 ? localConfig.targetVoltage : (sourceNode?.tensionCible || 230);
      
      // Lancer la simulation forcée avec algorithme de convergence
      const result = await calculator.runForcedModeConvergence(
        currentProject,
        { U1, U2, U3 },
        localConfig.measurementNodeId,
        sourceVoltage
      );
      
      if (result.result) {
        // Stocker les résultats de la simulation
        const enhancedResult = {
          ...result.result,
          convergenceStatus: result.convergenceStatus,
          voltageErrors: result.voltageErrors,
          iterations: result.iterations,
          finalLoadDistribution: result.finalLoadDistribution,
          finalProductionDistribution: result.finalProductionDistribution,
          calibratedFoisonnementCharges: result.calibratedFoisonnementCharges
        };
        
        setSimulationResults_local(enhancedResult);
        
        // Mettre à jour le preview dans the store
        updateSimulationPreview({
          foisonnementCharges: result.calibratedFoisonnementCharges || result.foisonnementCharges,
          loadDistribution: result.finalLoadDistribution,
          productionDistribution: result.finalProductionDistribution,
          desequilibrePourcent: result.desequilibrePourcent
        });

        // Message de succès/échec
        if (result.convergenceStatus === 'converged') {
          toast.success(`Simulation convergée en ${result.iterations} itérations !`);
        } else {
          toast.warning("Simulation terminée sans convergence complète");
        }
        
        // Débloquer les curseurs après la simulation
        clearSimulationPreview();
      } else {
        toast.error("Échec de la simulation forcée");
      }
      
    } catch (error) {
      console.error('Erreur simulation forcée:', error);
      toast.error("Erreur lors de la simulation forcée");
    }
  };

  const saveSimulationResults = () => {
    if (!simulationResults_local || simulationResults_local.convergenceStatus !== 'converged') return;
    
    // Appliquer les pourcentages de répartition optimisés au projet
    const updatedConfig: any = {};
    
    // Sauvegarder les répartitions finales si disponibles
    if (simulationResults_local.finalLoadDistribution || simulationResults_local.finalProductionDistribution) {
      updatedConfig.manualPhaseDistribution = {
        charges: simulationResults_local.finalLoadDistribution || {A: 33.33, B: 33.33, C: 33.33},
        productions: simulationResults_local.finalProductionDistribution || {A: 33.33, B: 33.33, C: 33.33},
        constraints: {min: 15, max: 70, total: 100}
      };
    }
    
    // Sauvegarder le foisonnement calibré si disponible
    if (simulationResults_local.calibratedFoisonnementCharges !== undefined) {
      updatedConfig.foisonnementCharges = simulationResults_local.calibratedFoisonnementCharges;
    }
    
    // Appliquer les changements au projet
    updateProjectConfig(updatedConfig);
    
    // Déclencher la mise à jour des calculs avec les nouveaux paramètres
    updateAllCalculations();
    
    console.log('✅ Résultats appliqués au projet:', {
      foisonnement: simulationResults_local.calibratedFoisonnementCharges,
      charges: simulationResults_local.finalLoadDistribution,
      productions: simulationResults_local.finalProductionDistribution
    });
    
    // Réinitialiser les résultats locaux après sauvegarde
    setSimulationResults_local(null);
    clearSimulationPreview();
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
          Calibrez le réseau en utilisant des mesures réelles de tension sur 3 phases
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

        {/* Phase 2: Tensions mesurées pour répartition des phases */}
        <div className="space-y-2">
          <Label className="text-xs font-medium">Tensions mesurées pour déséquilibre (V)</Label>
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
                {simulationResults_local.iterations && (
                  <Badge variant="outline" className="text-xs">
                    {simulationResults_local.iterations} itérations
                  </Badge>
                )}
              </div>
              
              {/* Statut de convergence */}
              <div className={`p-3 rounded-md flex items-center gap-2 ${
                simulationResults_local.convergenceStatus === 'converged' 
                  ? 'bg-green-50 text-green-700 border border-green-200' 
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {simulationResults_local.convergenceStatus === 'converged' ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="text-sm font-medium">Simulation convergée avec succès</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">Échec de la convergence</span>
                  </>
                )}
              </div>

              {/* Erreurs de tension */}
              {simulationResults_local.voltageErrors && (
                <div className="bg-muted/50 p-3 rounded-md">
                  <div className="text-xs font-medium mb-2">Erreurs de tension finales :</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>Phase A: {Math.abs(simulationResults_local.voltageErrors.A).toFixed(2)}V</div>
                    <div>Phase B: {Math.abs(simulationResults_local.voltageErrors.B).toFixed(2)}V</div>
                    <div>Phase C: {Math.abs(simulationResults_local.voltageErrors.C).toFixed(2)}V</div>
                  </div>
                </div>
              )}

              {/* Répartition finale des charges */}
              {simulationResults_local.finalLoadDistribution && (
                <div className="bg-blue-50/50 p-3 rounded-md border border-blue-200">
                  <div className="text-xs font-medium mb-2 text-blue-800">Répartition optimisée des charges :</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-white/50 p-2 rounded text-center">
                      <div className="text-muted-foreground">Phase A</div>
                      <div className="font-semibold text-blue-700">{simulationResults_local.finalLoadDistribution.A.toFixed(1)}%</div>
                    </div>
                    <div className="bg-white/50 p-2 rounded text-center">
                      <div className="text-muted-foreground">Phase B</div>
                      <div className="font-semibold text-blue-700">{simulationResults_local.finalLoadDistribution.B.toFixed(1)}%</div>
                    </div>
                    <div className="bg-white/50 p-2 rounded text-center">
                      <div className="text-muted-foreground">Phase C</div>
                      <div className="font-semibold text-blue-700">{simulationResults_local.finalLoadDistribution.C.toFixed(1)}%</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Répartition finale des productions */}
              {simulationResults_local.finalProductionDistribution && (
                <div className="bg-green-50/50 p-3 rounded-md border border-green-200">
                  <div className="text-xs font-medium mb-2 text-green-800">Répartition optimisée des productions :</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-white/50 p-2 rounded text-center">
                      <div className="text-muted-foreground">Phase A</div>
                      <div className="font-semibold text-green-700">{simulationResults_local.finalProductionDistribution.A.toFixed(1)}%</div>
                    </div>
                    <div className="bg-white/50 p-2 rounded text-center">
                      <div className="text-muted-foreground">Phase B</div>
                      <div className="font-semibold text-green-700">{simulationResults_local.finalProductionDistribution.B.toFixed(1)}%</div>
                    </div>
                    <div className="bg-white/50 p-2 rounded text-center">
                      <div className="text-muted-foreground">Phase C</div>
                      <div className="font-semibold text-green-700">{simulationResults_local.finalProductionDistribution.C.toFixed(1)}%</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Foisonnement calibré */}
              {simulationResults_local.calibratedFoisonnementCharges && (
                <div className="bg-orange-50/50 p-3 rounded-md border border-orange-200">
                  <div className="text-xs font-medium mb-1 text-orange-800">Foisonnement calibré :</div>
                  <div className="text-lg font-semibold text-orange-700 text-center">
                    {simulationResults_local.calibratedFoisonnementCharges.toFixed(1)}%
                  </div>
                </div>
              )}

              {/* Boutons d'action */}
              <div className="space-y-2">
                {simulationResults_local.convergenceStatus === 'converged' && (
                  <Button
                    onClick={saveSimulationResults}
                    className="w-full"
                    variant="default"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Appliquer les résultats au projet
                  </Button>
                )}
                
                <Button
                  onClick={() => {
                    setSimulationResults_local(null);
                    clearSimulationPreview();
                  }}
                  className="w-full"
                  variant="outline"
                >
                  <Calculator className="h-4 w-4 mr-2" />
                  Nouvelle simulation
                </Button>
              </div>
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
            onClick={() => {
              setSimulationResults_local(null);
              clearSimulationPreview();
            }}
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