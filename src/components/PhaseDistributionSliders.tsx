import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RotateCcw } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";

interface PhaseDistributionSlidersProps {
  type: 'charges' | 'productions';
  title: string;
}

export const PhaseDistributionSliders = ({ type, title }: PhaseDistributionSlidersProps) => {
  const { currentProject, updateProjectConfig } = useNetworkStore();
  
  if (!currentProject || !currentProject.manualPhaseDistribution) return null;
  
  const distribution = currentProject.manualPhaseDistribution[type];
  const isMonophaseMode = currentProject.loadModel === 'monophase_reparti';
  
  const initializeToBalance = () => {
    updateProjectConfig({
      manualPhaseDistribution: {
        ...currentProject.manualPhaseDistribution,
        [type]: {
          A: 33.33,
          B: 33.33,
          C: 33.34
        }
      }
    });
  };
  
  // Calcul des valeurs kVA par phase
  const calculateKVAValues = () => {
    let totalValue = 0;
    
    currentProject.nodes.forEach(node => {
      if (type === 'charges' && node.clients && node.clients.length > 0) {
        node.clients.forEach(client => {
          totalValue += (client.S_kVA || 0) * (currentProject.foisonnementCharges / 100);
        });
      } else if (type === 'productions' && node.productions && node.productions.length > 0) {
        node.productions.forEach(production => {
          totalValue += (production.S_kVA || 0) * (currentProject.foisonnementProductions / 100);
        });
      }
    });
    
    return {
      A: totalValue * (distribution.A / 100),
      B: totalValue * (distribution.B / 100),
      C: totalValue * (distribution.C / 100)
    };
  };

  const kvaValues = calculateKVAValues();
  
  const handlePhaseChange = (phase: 'A' | 'B' | 'C', newValue: number) => {
    const otherPhases = phase === 'A' ? ['B', 'C'] as const : 
                      phase === 'B' ? ['A', 'C'] as const : 
                      ['A', 'B'] as const;
    
    // Calculer ce qui reste à répartir sur les deux autres phases
    const remaining = 100 - newValue;
    const otherTotal = distribution[otherPhases[0]] + distribution[otherPhases[1]];
    
    // Si les autres phases sont à 0, répartir équitablement
    if (otherTotal === 0) {
      const half = remaining / 2;
      updateProjectConfig({
        manualPhaseDistribution: {
          ...currentProject.manualPhaseDistribution,
          [type]: {
            ...distribution,
            [phase]: newValue,
            [otherPhases[0]]: half,
            [otherPhases[1]]: remaining - half
          }
        }
      });
    } else {
      // Maintenir les proportions relatives entre les deux autres phases
      const ratio0 = distribution[otherPhases[0]] / otherTotal;
      const ratio1 = distribution[otherPhases[1]] / otherTotal;
      
      updateProjectConfig({
        manualPhaseDistribution: {
          ...currentProject.manualPhaseDistribution,
          [type]: {
            ...distribution,
            [phase]: newValue,
            [otherPhases[0]]: remaining * ratio0,
            [otherPhases[1]]: remaining * ratio1
          }
        }
      });
    }
  };

  const colorClasses = type === 'charges' 
    ? 'from-blue-500 to-blue-300' 
    : 'from-green-500 to-green-300';

  return (
    <div className="flex flex-col gap-3 p-3 bg-white/5 rounded border border-white/10">
      <div className="flex items-center justify-center gap-2">
        <Label className="text-xs font-medium text-primary-foreground text-center">{title}</Label>
        {isMonophaseMode && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={initializeToBalance}
                  className="h-6 w-6"
                >
                  <RotateCcw className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Reset Equilibre</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="flex justify-center gap-4">
        {(['A', 'B', 'C'] as const).map((phase) => (
          <div key={phase} className="flex flex-col items-center gap-2">
            <Label className="text-xs text-primary-foreground/80 font-medium">{phase}</Label>
            
            {/* Vertical Slider avec barre colorée */}
            <div className="relative flex flex-col items-center">
              <div className="relative w-6 h-20 bg-muted rounded-md border">
                {/* Barre de progression colorée */}
                <div 
                  className={`absolute bottom-0 w-full bg-gradient-to-t ${colorClasses} rounded-md transition-all duration-200`}
                  style={{ height: `${(distribution[phase] / 53.33) * 100}%` }}
                />
                {/* Curseur traditionnel par-dessus */}
                <Slider
                  value={[distribution[phase]]}
                  onValueChange={(values) => handlePhaseChange(phase, values[0])}
                  min={13.33}
                  max={53.33}
                  step={0.1}
                  orientation="vertical"
                  className="absolute inset-0 h-20 opacity-80"
                />
              </div>
            </div>
            
            {/* Affichage des valeurs */}
            <div className="text-center">
              <div className="text-xs font-mono text-primary-foreground">
                {distribution[phase].toFixed(1)}%
              </div>
              <div className="text-xs text-primary-foreground/80">
                {kvaValues[phase].toFixed(1)}kVA
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};