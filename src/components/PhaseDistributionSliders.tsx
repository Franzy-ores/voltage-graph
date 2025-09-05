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
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {(['A', 'B', 'C'] as const).map((phase) => (
          <div key={phase} className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-xs">Phase {phase}</Label>
              <span className="text-xs font-mono">{distribution[phase].toFixed(1)}%</span>
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
        <div className="text-xs text-muted-foreground text-center">
          Total: {(distribution.A + distribution.B + distribution.C).toFixed(1)}%
        </div>
      </CardContent>
    </Card>
  );
};