import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FileText, Save, FolderOpen, Settings, Zap, Target } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
import { useState } from "react";

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
    selectedNodeId,
    calculateWithTargetVoltage
  } = useNetworkStore();

  const [tensionCible, setTensionCible] = useState<string>('');
  const [nodeIdCible, setNodeIdCible] = useState<string>('');

  const selectedNode = currentProject?.nodes?.find(n => n.id === selectedNodeId);

  const handleApplyTensionCible = () => {
    const tension = parseFloat(tensionCible);
    if (nodeIdCible && tension > 0) {
      calculateWithTargetVoltage(nodeIdCible, tension);
    }
  };

  return (
    <div className="bg-gradient-primary text-primary-foreground shadow-lg border-b border-primary/20">
      <div className="flex items-center justify-between px-6 py-4">
        {/* Logo and Title */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/10 rounded-lg">
            <Zap className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">
              Calcul de Chute de Tension
              {tensionCible && nodeIdCible && (
                <span className="text-sm font-normal ml-2">
                  - Cible: {tensionCible}V sur nœud {nodeIdCible}
                </span>
              )}
            </h1>
            <p className="text-primary-foreground/80 text-sm">Réseau Électrique BT</p>
          </div>
        </div>

        {/* Controls */}
        {currentProject && (
          <div className="flex items-center gap-6">
            {/* Tension Cible */}
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              <Label className="text-sm font-medium whitespace-nowrap">Nœud:</Label>
              <Input
                type="text"
                placeholder="ID"
                value={nodeIdCible}
                onChange={(e) => setNodeIdCible(e.target.value)}
                className="w-20 h-8 text-xs"
              />
              <Label className="text-sm font-medium whitespace-nowrap">V:</Label>
              <Input
                type="number"
                placeholder="230"
                value={tensionCible}
                onChange={(e) => setTensionCible(e.target.value)}
                className="w-16 h-8 text-xs"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleApplyTensionCible}
                disabled={!tensionCible || !nodeIdCible}
                className="h-8 px-2 text-xs"
              >
                Ajuster
              </Button>
            </div>

            {/* Charges Slider */}
            <div className="flex items-center gap-3 min-w-[200px]">
              <Label className="text-sm font-medium whitespace-nowrap">
                Charges {currentProject.foisonnementCharges}%
              </Label>
              <Slider
                value={[currentProject.foisonnementCharges]}
                onValueChange={(value) => setFoisonnementCharges(value[0])}
                max={100}
                min={0}
                step={1}
                className="flex-1"
              />
            </div>

            {/* Productions Slider */}
            <div className="flex items-center gap-3 min-w-[200px]">
              <Label className="text-sm font-medium whitespace-nowrap">
                Productions {currentProject.foisonnementProductions}%
              </Label>
              <Slider
                value={[currentProject.foisonnementProductions]}
                onValueChange={(value) => setFoisonnementProductions(value[0])}
                max={100}
                min={0}
                step={1}
                className="flex-1"
              />
            </div>
          </div>
        )}

        {/* Menu Actions */}
        <div className="flex items-center gap-2">
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