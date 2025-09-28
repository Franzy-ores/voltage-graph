import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { Node } from "@/types/network";
import { getNodeConnectionType } from '@/utils/nodeConnectionType';

interface NodeSelectorProps {
  nodes: Node[];
  onNodeSelected: (nodeId: string) => void;
  disabled?: boolean;
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  // Ajout pour connaître le contexte du projet
  voltageSystem?: 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V';
  loadModel?: 'monophase_reparti' | 'polyphase_equilibre';
}

export const NodeSelector = ({ 
  nodes, 
  onNodeSelected, 
  disabled, 
  trigger, 
  title,
  description,
  voltageSystem = 'TÉTRAPHASÉ_400V',
  loadModel = 'polyphase_equilibre'
}: NodeSelectorProps) => {
  const [open, setOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");

  const availableNodes = nodes.filter(n => !n.isSource);

  const handleAdd = () => {
    if (selectedNodeId) {
      onNodeSelected(selectedNodeId);
      setSelectedNodeId("");
      setOpen(false);
    }
  };

  // SUPPRIMÉ - code des régulateurs

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" variant="outline" disabled={disabled || !availableNodes.length}>
            <Plus className="h-3 w-3 mr-1" />
            Ajouter
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-4">
          {availableNodes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center">
              Aucun nœud disponible. Ajoutez d'abord des nœuds au réseau.
            </p>
          ) : (
            <>
              <Select value={selectedNodeId} onValueChange={setSelectedNodeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un nœud" />
                </SelectTrigger>
                <SelectContent>
                  {availableNodes.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      <div className="flex items-center justify-between w-full">
                        <span>{node.name}</span>
                        <Badge variant="outline" className="ml-2 text-xs">
                          {getNodeConnectionType(voltageSystem, loadModel, node.isSource).replace('_', ' ')}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <div className="flex gap-2">
                <Button
                  onClick={handleAdd}
                  disabled={!selectedNodeId}
                  className="flex-1"
                >
                  Ajouter
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setOpen(false)}
                  className="flex-1"
                >
                  Annuler
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};