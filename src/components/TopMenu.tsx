import { Button } from "@/components/ui/button";
import { FileText, Save, FolderOpen, Settings, Zap } from "lucide-react";

interface TopMenuProps {
  onNewNetwork: () => void;
  onSave: () => void;
  onLoad: () => void;
  onSettings: () => void;
}

export const TopMenu = ({ onNewNetwork, onSave, onLoad, onSettings }: TopMenuProps) => {
  return (
    <div className="bg-gradient-primary text-primary-foreground shadow-lg border-b border-primary/20">
      <div className="flex items-center justify-between px-6 py-4">
        {/* Logo and Title */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/10 rounded-lg">
            <Zap className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Calcul de Chute de Tension</h1>
            <p className="text-primary-foreground/80 text-sm">Réseau Électrique BT</p>
          </div>
        </div>

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