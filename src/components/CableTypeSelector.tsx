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

  // Retourner early si pas les bonnes conditions
  if (!currentProject || selectedTool !== 'addCable') {
    return null;
  }

  const selectedType = currentProject.cableTypes.find(ct => ct.id === selectedCableType);

  return (
    <div className="fixed top-4 left-20 bg-white border-2 border-blue-500 rounded-lg p-4 min-w-[300px] shadow-2xl z-[9999]">
      <div className="space-y-3">
        <div className="text-lg font-bold text-blue-600">🔌 Sélection du type de câble</div>
        
        <Select value={selectedCableType} onValueChange={setSelectedCableType}>
          <SelectTrigger className="w-full bg-white border-2">
            <SelectValue placeholder="Sélectionner un type de câble" />
          </SelectTrigger>
          <SelectContent className="bg-white border-2 z-[10000] max-h-[500px] overflow-y-auto">
            {currentProject.cableTypes.map((cableType) => (
              <SelectItem key={cableType.id} value={cableType.id} className="min-h-[60px] py-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{cableType.label}</span>
                    <span className="text-xs text-gray-500">({cableType.matiere})</span>
                  </div>
                  <div className="flex gap-1">
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
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedType && (
          <div className="text-xs text-gray-600 space-y-1">
            <div>Matière: {selectedType.matiere}</div>
            <div>Poses: {selectedType.posesPermises.join(', ')}</div>
            <div className="mt-2 p-2 bg-gray-100 rounded">
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