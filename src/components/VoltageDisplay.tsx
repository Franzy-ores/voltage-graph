import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNetworkStore } from '@/store/networkStore';

export const VoltageDisplay = () => {
  const { 
    showVoltages, 
    setShowVoltages, 
    selectedScenario, 
    setSelectedScenario,
    currentProject 
  } = useNetworkStore();

  console.log('VoltageDisplay render - currentProject:', !!currentProject);

  if (!currentProject) return null;

  return (
    <Card className="fixed bottom-4 left-80 w-80 bg-background/95 backdrop-blur-sm z-[9999]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">
          Scénario de calcul
          {currentProject && (
            <div className="text-xs font-normal text-muted-foreground mt-1">
              Système: {currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' ? '400V' : '230V'} - cos φ = {currentProject.cosPhi}
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm">Scénario actuel</Label>
          <Select value={selectedScenario || 'PRÉLÈVEMENT'} onValueChange={setSelectedScenario}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PRÉLÈVEMENT">Prélèvement seul</SelectItem>
              <SelectItem value="MIXTE">Mixte</SelectItem>
              <SelectItem value="PRODUCTION">Production pure</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex items-center space-x-2">
          <Switch
            id="voltage-display"
            checked={showVoltages}
            onCheckedChange={setShowVoltages}
          />
          <Label htmlFor="voltage-display" className="text-sm">
            Afficher tensions sur les nœuds
          </Label>
        </div>
      </CardContent>
    </Card>
  );
};