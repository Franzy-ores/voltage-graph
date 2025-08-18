import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNetworkStore } from '@/store/networkStore';
import { Badge } from '@/components/ui/badge';

export const CableTypeSelector = () => {
  const { 
    currentProject, 
    selectedCableType, 
    setSelectedCableType,
    selectedTool 
  } = useNetworkStore();

  if (!currentProject || selectedTool !== 'addCable') {
    return null;
  }

  const selectedType = currentProject.cableTypes.find(ct => ct.id === selectedCableType);

  return (
    <div className="absolute top-16 left-20 bg-background border rounded-lg p-4 min-w-[280px] shadow-xl z-50">
      <div className="space-y-3">
        <div className="text-sm font-medium">Type de câble</div>
        
        <Select value={selectedCableType} onValueChange={setSelectedCableType}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Sélectionner un type de câble" />
          </SelectTrigger>
          <SelectContent>
            {currentProject.cableTypes.map((cableType) => (
              <SelectItem key={cableType.id} value={cableType.id}>
                <div className="flex items-center gap-2">
                  <span>{cableType.label}</span>
                  {cableType.posesPermises.map(pose => (
                    <Badge 
                      key={pose} 
                      variant={pose === 'AÉRIEN' ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {pose}
                    </Badge>
                  ))}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedType && (
          <div className="text-xs text-muted-foreground space-y-1">
            <div>Matière: {selectedType.matiere}</div>
            <div>Poses: {selectedType.posesPermises.join(', ')}</div>
            <div className="mt-2 p-2 bg-muted/50 rounded">
              {selectedType.posesPermises.includes('AÉRIEN') && !selectedType.posesPermises.includes('SOUTERRAIN') 
                ? "🔸 Câble aérien: connexion en ligne droite automatique"
                : "🔸 Câble souterrain: tracé manuel avec points intermédiaires"
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
};