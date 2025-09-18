import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNetworkStore } from "@/store/networkStore";

interface PhaseDistributionSlidersProps {
  type: 'charges' | 'productions';
  title: string;
}

export const PhaseDistributionSliders = ({ type, title }: PhaseDistributionSlidersProps) => {
  const { currentProject, updateProjectConfig } = useNetworkStore();
  
  if (!currentProject || !currentProject.manualPhaseDistribution) return null;
  
  const distribution = currentProject.manualPhaseDistribution[type];
  
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

  return (
    <div className="flex flex-col gap-2 p-3 bg-white/5 rounded border border-white/10">
      <Label className="text-xs font-medium text-primary-foreground">{title}</Label>
      <div className="flex gap-3">
        {(['A', 'B', 'C'] as const).map((phase) => (
          <div key={phase} className="flex flex-col gap-1 min-w-[60px]">
            <div className="flex justify-between items-center">
              <Label className="text-xs text-primary-foreground/80">{phase}</Label>
              <span className="text-xs font-mono text-primary-foreground">{distribution[phase].toFixed(1)}%</span>
            </div>
            <Slider
              value={[distribution[phase]]}
              onValueChange={(values) => handlePhaseChange(phase, values[0])}
              min={13.33}
              max={53.33}
              step={0.1}
              className="w-full"
            />
          </div>
        ))}
      </div>
    </div>
  );
};