import { Button } from '@/components/ui/button';
import { useNetworkStore } from '@/store/networkStore';
import { toast } from 'sonner';

export const Toolbar = () => {
  const { 
    selectedTool, 
    setSelectedTool, 
    currentProject, 
    calculateAll,
    setSelectedNode
  } = useNetworkStore();

  const handleCalculate = () => {
    if (!currentProject) {
      toast.error('Aucun projet ouvert');
      return;
    }
    
    if (currentProject.nodes.length === 0) {
      toast.error('Ajoutez au moins un nœud');
      return;
    }
    
    calculateAll();
    toast.success('Calculs effectués pour tous les scénarios');
  };

  const tools = [
    {
      id: 'select' as const,
      emoji: '↖️',
      label: 'Sélectionner',
      description: 'Mode sélection'
    },
    {
      id: 'addNode' as const,
      emoji: '➕',
      label: 'Ajouter nœud',
      description: 'Cliquer pour ajouter un nœud'
    },
    {
      id: 'addCable' as const,
      emoji: '🔌',
      label: 'Ajouter câble',
      description: 'Connecter deux nœuds'
    },
    {
      id: 'edit' as const,
      emoji: '⚙️',
      label: 'Éditer',
      description: 'Modifier les propriétés'
    },
    {
      id: 'move' as const,
      emoji: '✋',
      label: 'Déplacer',
      description: 'Déplacer un nœud'
    },
    {
      id: 'delete' as const,
      emoji: '🗑️',
      label: 'Supprimer',
      description: 'Supprimer un élément'
    }
  ];

  return (
    <div className="w-16 bg-muted/30 border-r flex flex-col items-center py-4 gap-2">
      {tools.map((tool) => {
        return (
          <Button
            key={tool.id}
            variant={selectedTool === tool.id ? "default" : "ghost"}
            size="icon"
            onClick={() => {
              console.log('Tool selected:', tool.id);
              setSelectedTool(tool.id);
              // Réinitialiser la sélection de nœud quand on change d'outil
              setSelectedNode(null);
            }}
            title={tool.description}
            className="w-12 h-12"
          >
            <span className="text-lg">{tool.emoji}</span>
          </Button>
        );
      })}
      
      <Button
        onClick={handleCalculate}
        variant="outline"
        size="icon"
        title="Calculer tous les scénarios"
        className="w-12 h-12"
        disabled={!currentProject}
      >
        <span className="text-lg">📊</span>
      </Button>
    </div>
  );
};