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

  if (!currentProject) return null;

  return (
    <Card className="absolute top-4 right-4 w-80 bg-background/95 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Affichage des résultats</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center space-x-2">
          <Switch
            id="voltage-display"
            checked={showVoltages}
            onCheckedChange={setShowVoltages}
          />
          <Label htmlFor="voltage-display" className="text-sm">
            Afficher les tensions
          </Label>
        </div>
        
        <div className="space-y-2">
          <Label className="text-sm">Scénario de calcul</Label>
          <Select value={selectedScenario} onValueChange={setSelectedScenario}>
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
      </CardContent>
    </Card>
  );
};