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
    setFoisonnementCharges, 
    setFoisonnementProductions,
    showVoltages,
    setShowVoltages,
    selectedScenario,
    setSelectedScenario,
    changeVoltageSystem,
    calculationResults,
    updateCableTypes,
    updateProjectConfig
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
              <div className="text-xs text-primary-foreground/80">
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
              Jeu de barres: {typeof calculationResults[selectedScenario]!.virtualBusbar!.voltage_V === 'number' ? calculationResults[selectedScenario]!.virtualBusbar!.voltage_V.toFixed(1) : '0.0'}V - 
              {typeof calculationResults[selectedScenario]!.virtualBusbar!.current_A === 'number' ? Math.abs(calculationResults[selectedScenario]!.virtualBusbar!.current_A).toFixed(1) : '0.0'}A
              {calculationResults[selectedScenario]!.virtualBusbar!.current_N !== undefined && (
                <> - I_N: {calculationResults[selectedScenario]!.virtualBusbar!.current_N.toFixed(1)}A</>
              )} - 
              ΔU: {typeof calculationResults[selectedScenario]!.virtualBusbar!.deltaU_V === 'number' ? 
                (calculationResults[selectedScenario]!.virtualBusbar!.deltaU_V >= 0 ? '+' : '') + calculationResults[selectedScenario]!.virtualBusbar!.deltaU_V.toFixed(2) : 
                '0.00'}V
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

              {/* Foisonnement Sliders - sous Modèle */}
              <div className="flex items-center gap-4">
                {/* Charges Slider */}
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-medium">Charges {currentProject.foisonnementCharges}%</Label>
                  <Slider
                    value={[currentProject.foisonnementCharges]}
                    onValueChange={(value) => setFoisonnementCharges(value[0])}
                    max={100}
                    min={0}
                    step={1}
                    className="w-32 slider-charges"
                  />
                </div>

                {/* Productions Slider */}
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-medium">Productions {currentProject.foisonnementProductions}%</Label>
                  <Slider
                    value={[currentProject.foisonnementProductions]}
                    onValueChange={(value) => setFoisonnementProductions(value[0])}
                    max={100}
                    min={0}
                    step={1}
                    className="w-32 slider-productions"
                  />
                </div>
              </div>

              {/* Unbalance Controls - Only for monophase_reparti */}
              {currentProject.loadModel === 'monophase_reparti' && (
                <div className="flex items-center gap-3">
                  <Label className="text-sm font-medium">
                    Déséquilibre {currentProject.desequilibrePourcent || 0}%
                  </Label>
                  <div className="flex items-center gap-2 min-w-[180px]">
                    <Progress 
                      value={currentProject.desequilibrePourcent || 0} 
                      max={30}
                      className="flex-1 h-2"
                    />
                    <Slider
                      value={[currentProject.desequilibrePourcent || 0]}
                      onValueChange={(value) => updateProjectConfig({ desequilibrePourcent: value[0] })}
                      max={30}
                      min={0}
                      step={1}
                      className="w-20"
                    />
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