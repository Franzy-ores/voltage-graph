import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { FileText, Save, FolderOpen, Settings, Zap, FileDown } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
import { PDFGenerator } from "@/utils/pdfGenerator";
import { toast } from "sonner";

interface TopMenuProps {
  onNewNetwork: () => void;
  onSave: () => void;
  onLoad: () => void;
  onSettings: () => void;
}

export const TopMenu = ({ onNewNetwork, onSave, onLoad, onSettings }: TopMenuProps) => {
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
    updateCableTypes
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
      {/* Title Section - Full Width */}
      <div className="flex items-center justify-center px-6 py-3 border-b border-primary-foreground/10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/10 rounded-lg">
            <Zap className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Calcul de Chute de Tension</h1>
            <p className="text-primary-foreground/80 text-sm">Réseau Électrique BT</p>
          </div>
        </div>
      </div>

      {/* Controls and Buttons Section */}
      <div className="flex items-center justify-between px-6 py-3">
        {/* Controls */}
        {currentProject && (
          <div className="flex items-center gap-6">
            {/* Scenario Selector */}
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium whitespace-nowrap">Scénario:</Label>
              <Select value={selectedScenario || 'PRÉLÈVEMENT'} onValueChange={setSelectedScenario}>
                <SelectTrigger className="w-[140px] bg-white/10 border-white/20 text-primary-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background border z-[10000]">
                  <SelectItem value="PRÉLÈVEMENT">Prélèvement</SelectItem>
                  <SelectItem value="MIXTE">Mixte</SelectItem>
                  <SelectItem value="PRODUCTION">Production</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Transformer and Virtual Busbar Info */}
            <div className="text-xs text-primary-foreground/80 flex flex-col gap-1">
              <div>
                {currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' ? '400V' : '230V'} - cos φ = {currentProject.cosPhi}
              </div>
              <div>
                Transformateur: {currentProject.transformerConfig.rating} ({currentProject.transformerConfig.nominalPower_kVA} kVA)
              </div>
              {calculationResults[selectedScenario]?.virtualBusbar && (
                <div className="font-medium">
                  Jeu de barres: {calculationResults[selectedScenario]!.virtualBusbar!.voltage_V.toFixed(1)}V - 
                  {calculationResults[selectedScenario]!.virtualBusbar!.current_A.toFixed(1)}A - 
                  ΔU: +{calculationResults[selectedScenario]!.virtualBusbar!.voltageRise_V.toFixed(2)}V
                </div>
              )}
            </div>

            {/* Voltage Display Switch */}
            <div className="flex items-center gap-2">
              <Switch 
                id="voltage-display" 
                checked={showVoltages} 
                onCheckedChange={setShowVoltages}
                className="data-[state=checked]:bg-white/20"
              />
              <Label htmlFor="voltage-display" className="text-sm font-medium whitespace-nowrap">
                Tensions
              </Label>
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

            {/* Charges and Productions Sliders - Vertical Layout */}
            <div className="flex flex-col gap-2">
              {/* Charges Slider */}
              <div className="flex items-center gap-3 min-w-[180px]">
                <Label className="text-sm font-medium whitespace-nowrap">
                  Charges {currentProject.foisonnementCharges}%
                </Label>
                <Slider
                  value={[currentProject.foisonnementCharges]}
                  onValueChange={(value) => setFoisonnementCharges(value[0])}
                  max={100}
                  min={0}
                  step={1}
                  className="flex-1 slider-charges"
                />
              </div>

              {/* Productions Slider */}
              <div className="flex items-center gap-3 min-w-[180px]">
                <Label className="text-sm font-medium whitespace-nowrap">
                  Productions {currentProject.foisonnementProductions}%
                </Label>
                <Slider
                  value={[currentProject.foisonnementProductions]}
                  onValueChange={(value) => setFoisonnementProductions(value[0])}
                  max={100}
                  min={0}
                  step={1}
                  className="flex-1 slider-productions"
                />
              </div>
            </div>
          </div>
        )}

        {/* Menu Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={handleExportPDF}
            disabled={!currentProject || !calculationResults[selectedScenario]}
            className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground disabled:opacity-50"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Exporter PDF
          </Button>
          
          <Button
            variant="ghost"
            onClick={onNewNetwork}
            className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
          >
            <FileText className="h-4 w-4 mr-2" />
            Nouveau Réseau
          </Button>
          
          <Button
            variant="ghost"
            onClick={onSave}
            className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
          >
            <Save className="h-4 w-4 mr-2" />
            Sauvegarder
          </Button>
          
          <Button
            variant="ghost"
            onClick={onLoad}
            className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            Charger
          </Button>
          
          <Button
            variant="ghost"
            onClick={updateCableTypes}
            disabled={!currentProject}
            className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground disabled:opacity-50"
          >
            <Settings className="h-4 w-4 mr-2" />
            Mettre à jour câbles
          </Button>
          
          <Button
            variant="ghost"
            onClick={onSettings}
            className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
          >
            <Settings className="h-4 w-4 mr-2" />
            Paramètres généraux
          </Button>
        </div>
      </div>
    </div>
  );
};