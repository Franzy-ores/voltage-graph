import { Button } from "@/components/ui/button";
import { CalculationScenario } from "@/types/electrical";
import { Zap, TrendingUp, ArrowUpCircle } from "lucide-react";

interface ScenarioSelectorProps {
  selectedScenario: CalculationScenario;
  onScenarioChange: (scenario: CalculationScenario) => void;
  onCalculate: () => void;
}

export const ScenarioSelector = ({ 
  selectedScenario, 
  onScenarioChange, 
  onCalculate 
}: ScenarioSelectorProps) => {
  const scenarios = [
    {
      id: 'consumption' as CalculationScenario,
      name: 'Prélèvement seul',
      description: 'Calcul avec charges uniquement',
      icon: TrendingUp,
      color: 'bg-primary'
    },
    {
      id: 'mixed' as CalculationScenario,
      name: 'Mixte',
      description: 'Prélèvement + Production',
      icon: Zap,
      color: 'bg-secondary'
    },
    {
      id: 'production' as CalculationScenario,
      name: 'Production seule',
      description: 'Injection uniquement',
      icon: ArrowUpCircle,
      color: 'bg-accent'
    }
  ];

  return (
    <div className="bg-card border-t border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="font-semibold text-foreground">Scénarios de Calcul</h3>
          
          <div className="flex gap-2">
            {scenarios.map((scenario) => {
              const Icon = scenario.icon;
              const isSelected = selectedScenario === scenario.id;
              
              return (
                <Button
                  key={scenario.id}
                  variant={isSelected ? "default" : "outline"}
                  onClick={() => onScenarioChange(scenario.id)}
                  className={`flex items-center gap-2 ${
                    isSelected ? '' : 'hover:bg-muted'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <div className="text-left">
                    <div className="text-sm font-medium">{scenario.name}</div>
                    <div className="text-xs opacity-75">{scenario.description}</div>
                  </div>
                </Button>
              );
            })}
          </div>
        </div>

        <Button 
          onClick={onCalculate}
          variant="professional"
          className="px-6"
        >
          <Zap className="h-4 w-4 mr-2" />
          Calculer
        </Button>
      </div>
    </div>
  );
};