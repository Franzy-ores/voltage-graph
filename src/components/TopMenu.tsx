import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Progress } from "@/components/ui/progress";
import { FileText, Save, FolderOpen, Settings, Zap, FileDown } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
import { PDFGenerator } from "@/utils/pdfGenerator";
import { PhaseDistributionDisplay } from "@/components/PhaseDistributionDisplay";
import { PhaseDistributionSliders } from "@/components/PhaseDistributionSliders";
import { toast } from "sonner";

interface TopMenuProps {
  onNewNetwork: () => void;
  onSave: () => void;
  onLoad: () => void;
  onSettings: () => void;
  onSimulation: () => void;
}

export const TopMenu = ({ onNewNetwork, onSave, onLoad, onSettings, onSimulation }: TopMenuProps) => {
  const { 
    currentProject, 
    showVoltages,
    setShowVoltages,
    selectedScenario,
    setSelectedScenario,
    changeVoltageSystem,
    calculationResults,
    updateCableTypes,
    updateProjectConfig,
    setFoisonnementCharges,
    setFoisonnementProductions,
    simulationPreview
  } = useNetworkStore();

  const handleExportPDF = async () => {
    if (!currentProject || !selectedScenario) {
      toast.error("Aucun projet ou scénario sélectionné.");
      return;
    }

    const generatePDF = async () => {
      const pdfGenerator = new PDFGenerator();
      await pdfGenerator.generateReport({
        project: currentProject,
        results: calculationResults,
        selectedScenario
      });
    };

    toast.promise(generatePDF(), {
      loading: "Génération du rapport PDF en cours...",
      success: "Rapport PDF généré avec succès !",
      error: "Erreur lors de la génération du rapport PDF."
    });
  };

  return (
    <div className="bg-gradient-primary text-primary-foreground shadow-lg border-b border-primary/20">
      {/* Title Section */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-primary-foreground/10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/10 rounded-lg">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Calcul de Chute de Tension</h1>
            <p className="text-primary-foreground/80 text-xs">Réseau Électrique BT</p>
          </div>
        </div>

        {/* Menu Actions - Always Visible */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExportPDF}
            disabled={!currentProject || !calculationResults[selectedScenario]}
            className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground disabled:opacity-50"
          >
            <FileDown className="h-4 w-4 mr-1" />
            PDF
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onNewNetwork}
            className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
          >
            <FileText className="h-4 w-4 mr-1" />
            Nouveau
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onSave}
            className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
          >
            <Save className="h-4 w-4 mr-1" />
            Sauvegarder
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onLoad}
            className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
          >
            <FolderOpen className="h-4 w-4 mr-1" />
            Charger
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={updateCableTypes}
            disabled={!currentProject}
            className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground disabled:opacity-50"
          >
            <Settings className="h-4 w-4 mr-1" />
            Câbles
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onSimulation}
            className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
          >
            <Zap className="h-4 w-4 mr-1" />
            Simulation
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onSettings}
            className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
          >
            <Settings className="h-4 w-4 mr-1" />
            Paramètres
          </Button>
        </div>
      </div>

      {/* Controls - When Project Exists */}
      {currentProject && (
        <div className="px-6 py-2 space-y-2">
          {/* First Row: Scenario, System Info, Voltage Switch */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {/* Scenario Selector */}
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium">Scénario:</Label>
                <Select value={selectedScenario || 'PRÉLÈVEMENT'} onValueChange={setSelectedScenario}>
                  <SelectTrigger className="w-[120px] bg-white/10 border-white/20 text-primary-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background border z-[10000]">
                    <SelectItem value="PRÉLÈVEMENT">Prélèvement</SelectItem>
                    <SelectItem value="MIXTE">Mixte</SelectItem>
                    <SelectItem value="PRODUCTION">Production</SelectItem>
                    <SelectItem value="FORCÉ">Forcé</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* System Info */}
              <div className="text-xs text-primary-foreground/120">
                {currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' ? '400V' : '230V'} - cos φ = {currentProject.cosPhi} - 
                Transfo: {currentProject.transformerConfig.rating} ({currentProject.transformerConfig.nominalPower_kVA} kVA)
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Voltage Display Switch */}
              <div className="flex items-center gap-2">
                <Switch 
                  id="voltage-display" 
                  checked={showVoltages} 
                  onCheckedChange={setShowVoltages}
                  className="data-[state=checked]:bg-white/20"
                />
                <Label htmlFor="voltage-display" className="text-sm font-medium">Tensions</Label>
              </div>

              {/* Change Voltage System Button */}
              <Button
                onClick={changeVoltageSystem}
                variant="ghost"
                size="sm"
                className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
              >
                {currentProject?.voltageSystem === 'TRIPHASÉ_230V' ? '230V → 400V' : '400V → 230V'}
              </Button>
            </div>
          </div>

          {/* Second Row: Virtual Busbar Info (if exists) */}
          {calculationResults[selectedScenario]?.virtualBusbar && (
            <div className="text-xs text-primary-foreground/90 font-medium bg-white/5 px-3 py-1 rounded">
              {(() => {
                const result = calculationResults[selectedScenario]!;
                const busbar = result.virtualBusbar!;
                const sourceNode = currentProject.nodes.find(node => node.isSource);
                const sourceMetrics = sourceNode && result.nodeMetricsPerPhase?.find(m => m.nodeId === sourceNode.id);
                
                // Pour monophasé 400V, afficher les tensions phase-neutre
                if (currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' && currentProject.loadModel === 'monophase_reparti' && sourceMetrics) {
                  // Les voltagesPerPhase sont multipliées par √3 dans le calcul, il faut les diviser pour avoir les tensions phase-neutre
                  const phaseNeutralA = sourceMetrics.voltagesPerPhase.A / Math.sqrt(3);
                  const phaseNeutralB = sourceMetrics.voltagesPerPhase.B / Math.sqrt(3);
                  const phaseNeutralC = sourceMetrics.voltagesPerPhase.C / Math.sqrt(3);
                  
                  return (
                    <>
                      Jeu de barres: VA: {phaseNeutralA.toFixed(1)}V - VB: {phaseNeutralB.toFixed(1)}V - VC: {phaseNeutralC.toFixed(1)}V - 
                      {typeof busbar.current_A === 'number' ? Math.abs(busbar.current_A).toFixed(1) : '0.0'}A
                      {busbar.current_N !== undefined && (
                        <> - I_N: {busbar.current_N.toFixed(1)}A</>
                      )} - 
                      ΔU: {typeof busbar.deltaU_V === 'number' ? 
                        (busbar.deltaU_V >= 0 ? '+' : '') + busbar.deltaU_V.toFixed(2) : 
                        '0.00'}V
                      {currentProject.desequilibrePourcent !== undefined && currentProject.desequilibrePourcent > 0 && (
                        <> - Déséquilibre: {currentProject.desequilibrePourcent.toFixed(1)}%</>
                      )}
                    </>
                  );
                }
                
                // Affichage standard
                return (
                  <>
                    Jeu de barres: {busbar.voltage_V.toFixed(1)}V - 
                    {typeof busbar.current_A === 'number' ? Math.abs(busbar.current_A).toFixed(1) : '0.0'}A
                    {busbar.current_N !== undefined && (
                      <> - I_N: {busbar.current_N.toFixed(1)}A</>
                    )} - 
                    ΔU: {typeof busbar.deltaU_V === 'number' ? 
                      (busbar.deltaU_V >= 0 ? '+' : '') + busbar.deltaU_V.toFixed(2) : 
                      '0.00'}V
                    {currentProject.desequilibrePourcent !== undefined && currentProject.desequilibrePourcent > 0 && (
                      <> - Déséquilibre: {currentProject.desequilibrePourcent.toFixed(1)}%</>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* Phase Distribution Display */}
          <PhaseDistributionDisplay />

          {/* Third Row: Load Model and Controls */}
          <div className="flex items-center justify-between gap-4">
            {/* Load Model Controls */}
            <div className="flex items-center gap-4">
              {/* Load Model Selector */}
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium">Modèle:</Label>
                <Select 
                  value={currentProject.loadModel || 'polyphase_equilibre'} 
                  onValueChange={(value: 'monophase_reparti' | 'polyphase_equilibre') => 
                    updateProjectConfig({ loadModel: value })
                  }
                >
                  <SelectTrigger className="w-[140px] bg-white/10 border-white/20 text-primary-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background border z-[10000]">
                    <SelectItem value="polyphase_equilibre">Polyphasé équilibré</SelectItem>
                    <SelectItem value="monophase_reparti">Monophasé réparti</SelectItem>
                  </SelectContent>
                </Select>
              </div>

                {/* Foisonnement Sliders - Vertical avec barres colorées */}
                <div className="flex items-start gap-6">
                  {/* Charges Slider - Vertical */}
                  <div className="flex flex-col items-center gap-2">
                    <Label className={`text-xs font-medium text-center ${simulationPreview.isActive && simulationPreview.foisonnementCharges !== undefined ? 'text-orange-300' : ''}`}>
                      Charges
                    </Label>
                    <div className="relative flex flex-col items-center">
                      {/* Barre de fond */}
                      <div className="relative w-6 h-20 bg-muted rounded-md border">
                        {/* Barre de progression colorée */}
                        <div 
                          className="absolute bottom-0 w-full bg-gradient-to-t from-blue-500 to-blue-300 rounded-md transition-all duration-200"
                          style={{ 
                            height: `${simulationPreview.isActive && simulationPreview.foisonnementCharges !== undefined ? simulationPreview.foisonnementCharges : currentProject.foisonnementCharges}%` 
                          }}
                        />
                        {/* Curseur traditionnel par-dessus */}
                        <Slider
                          value={[currentProject.foisonnementCharges]}
                          onValueChange={(value) => setFoisonnementCharges(value[0])}
                          max={100}
                          min={0}
                          step={1}
                          orientation="vertical"
                          className="absolute inset-0 h-20 slider-charges opacity-80"
                          disabled={simulationPreview.isActive}
                        />
                      </div>
                      <span className={`text-xs mt-1 font-medium ${simulationPreview.isActive && simulationPreview.foisonnementCharges !== undefined ? 'text-orange-300' : ''}`}>
                        {simulationPreview.isActive && simulationPreview.foisonnementCharges !== undefined ? simulationPreview.foisonnementCharges : currentProject.foisonnementCharges}%
                        {simulationPreview.isActive && simulationPreview.foisonnementCharges !== undefined && (
                          <span className="text-xs ml-1 text-orange-200">(sim)</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Productions Slider - Vertical */}
                  <div className="flex flex-col items-center gap-2">
                    <Label className="text-xs font-medium text-center">Productions</Label>
                    <div className="relative flex flex-col items-center">
                      {/* Barre de fond */}
                      <div className="relative w-6 h-20 bg-muted rounded-md border">
                        {/* Barre de progression colorée */}
                        <div 
                          className="absolute bottom-0 w-full bg-gradient-to-t from-green-500 to-green-300 rounded-md transition-all duration-200"
                          style={{ height: `${currentProject.foisonnementProductions}%` }}
                        />
                        {/* Curseur traditionnel par-dessus */}
                        <Slider
                          value={[currentProject.foisonnementProductions]}
                          onValueChange={(value) => setFoisonnementProductions(value[0])}
                          max={100}
                          min={0}
                          step={1}
                          orientation="vertical"
                          className="absolute inset-0 h-20 slider-productions opacity-80"
                          disabled={simulationPreview.isActive}
                        />
                      </div>
                      <span className="text-xs mt-1 font-medium">
                        {currentProject.foisonnementProductions}%
                      </span>
                    </div>
                  </div>
                </div>

              {/* Phase Distribution Sliders */}
              {currentProject.loadModel === 'monophase_reparti' && (
                <div className="flex items-center gap-4">
                  <div className="flex gap-4">
                    <PhaseDistributionSliders type="charges" title="Charges" />
                    <PhaseDistributionSliders type="productions" title="Productions" />
                  </div>
                </div>
              )}
            </div>

            {/* Spacer div pour maintenir la structure */}
            <div className="flex items-center gap-4"></div>
          </div>
        </div>
      )}
    </div>
  );
};