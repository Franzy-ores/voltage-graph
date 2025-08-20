import { Button } from '@/components/ui/button';
import { MousePointer, Plus, Cable, Edit, Trash2, Calculator } from 'lucide-react';
import { useNetworkStore } from '@/store/networkStore';
import { toast } from 'sonner';

export const Toolbar = () => {
  const { 
    selectedTool, 
    setSelectedTool, 
    currentProject, 
    calculateAll 
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
      icon: MousePointer,
      label: 'Sélectionner',
      description: 'Mode sélection'
    },
    {
      id: 'addNode' as const,
      icon: Plus,
      label: 'Ajouter nœud',
      description: 'Cliquer pour ajouter un nœud'
    },
    {
      id: 'addCable' as const,
      icon: Cable,
      label: 'Ajouter câble',
      description: 'Connecter deux nœuds'
    },
    {
      id: 'edit' as const,
      icon: Edit,
      label: 'Éditer',
      description: 'Modifier les propriétés'
    }
  ];

  return (
    <div className="w-16 bg-muted/30 border-r flex flex-col items-center py-4 gap-2">
      {tools.map((tool) => {
        const Icon = tool.icon;
        return (
          <Button
            key={tool.id}
            variant={selectedTool === tool.id ? "default" : "ghost"}
            size="icon"
            onClick={() => setSelectedTool(tool.id)}
            title={tool.description}
            className="w-12 h-12"
          >
            <Icon className="w-5 h-5" />
          </Button>
        );
      })}
      
      <div className="flex-1" />
      
      <Button
        onClick={handleCalculate}
        variant="outline"
        size="icon"
        title="Calculer tous les scénarios"
        className="w-12 h-12"
        disabled={!currentProject}
      >
        <Calculator className="w-5 h-5" />
      </Button>
    </div>
  );
};