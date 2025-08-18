import { useEffect, useRef, useState } from "react";
import { Canvas as FabricCanvas, Circle, Line, Text } from "fabric";
import { NetworkNode, Cable } from "@/types/electrical";
import { Button } from "@/components/ui/button";
import { Plus, Move, Cable as CableIcon, Trash2 } from "lucide-react";

interface NetworkCanvasProps {
  nodes: NetworkNode[];
  cables: Cable[];
  selectedTool: 'select' | 'addNode' | 'addCable' | 'delete';
  onAddNode: (x: number, y: number) => void;
  onAddCable: (fromNodeId: string, toNodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteCable: (cableId: string) => void;
  onToolChange: (tool: 'select' | 'addNode' | 'addCable' | 'delete') => void;
}

export const NetworkCanvas = ({
  nodes,
  cables,
  selectedTool,
  onAddNode,
  onAddCable,
  onDeleteNode,
  onDeleteCable,
  onToolChange
}: NetworkCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [selectedFromNode, setSelectedFromNode] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 800,
      height: 600,
      backgroundColor: "#ffffff",
    });

    // Add grid background
    const gridSize = 20;
    for (let i = 0; i < canvas.width! / gridSize; i++) {
      canvas.add(new Line([i * gridSize, 0, i * gridSize, canvas.height!], {
        stroke: '#f0f0f0',
        strokeWidth: 1,
        selectable: false,
        evented: false,
      }));
    }
    for (let i = 0; i < canvas.height! / gridSize; i++) {
      canvas.add(new Line([0, i * gridSize, canvas.width!, i * gridSize], {
        stroke: '#f0f0f0',
        strokeWidth: 1,
        selectable: false,
        evented: false,
      }));
    }

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, []);

  // Handle canvas clicks
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleCanvasClick = (e: any) => {
      if (selectedTool === 'addNode') {
        const pointer = fabricCanvas.getPointer(e.e);
        onAddNode(pointer.x, pointer.y);
      }
    };

    fabricCanvas.on('mouse:down', handleCanvasClick);

    return () => {
      fabricCanvas.off('mouse:down', handleCanvasClick);
    };
  }, [fabricCanvas, selectedTool, onAddNode]);

  // Render nodes
  useEffect(() => {
    if (!fabricCanvas) return;

      // Clear existing nodes (but keep grid)
      const objects = fabricCanvas.getObjects();
      objects.forEach(obj => {
        if ((obj as any).data?.type === 'node' || (obj as any).data?.type === 'nodeLabel') {
          fabricCanvas.remove(obj);
        }
      });

    nodes.forEach(node => {
      // Node circle
      const circle = new Circle({
        left: node.x - 15,
        top: node.y - 15,
        radius: 15,
        fill: '#1e40af',
        stroke: '#ffffff',
        strokeWidth: 3,
        data: { type: 'node', nodeId: node.id }
      });

      // Node label
      const label = new Text(node.name, {
        left: node.x,
        top: node.y - 40,
        fontSize: 12,
        fill: '#1e40af',
        fontFamily: 'Arial',
        textAlign: 'center',
        originX: 'center',
        data: { type: 'nodeLabel', nodeId: node.id }
      });

      fabricCanvas.add(circle, label);

      // Handle node clicks for cable creation
      circle.on('mousedown', () => {
        if (selectedTool === 'addCable') {
          if (!selectedFromNode) {
            setSelectedFromNode(node.id);
            circle.set('fill', '#f59e0b'); // Highlight selected node
            fabricCanvas.renderAll();
          } else if (selectedFromNode !== node.id) {
            onAddCable(selectedFromNode, node.id);
            setSelectedFromNode(null);
            // Reset node colors
            fabricCanvas.getObjects().forEach(obj => {
              if ((obj as any).data?.type === 'node') {
                obj.set('fill', '#1e40af');
              }
            });
            fabricCanvas.renderAll();
          }
        } else if (selectedTool === 'delete') {
          onDeleteNode(node.id);
        }
      });
    });

    fabricCanvas.renderAll();
  }, [fabricCanvas, nodes, selectedTool, selectedFromNode, onAddCable, onDeleteNode]);

  // Render cables
  useEffect(() => {
    if (!fabricCanvas) return;

    // Clear existing cables
    const objects = fabricCanvas.getObjects();
    objects.forEach(obj => {
      if ((obj as any).data?.type === 'cable') {
        fabricCanvas.remove(obj);
      }
    });

    cables.forEach(cable => {
      const fromNode = nodes.find(n => n.id === cable.fromNodeId);
      const toNode = nodes.find(n => n.id === cable.toNodeId);

      if (!fromNode || !toNode) return;

      // Determine cable color based on voltage drop
      let color = '#10b981'; // Green (normal)
      if (cable.voltageDropPercent) {
        const absVoltage = Math.abs(cable.voltageDropPercent);
        if (absVoltage > 10) color = '#ef4444'; // Red (critical)
        else if (absVoltage > 8) color = '#f59e0b'; // Orange (warning)
      }

      const line = new Line([fromNode.x, fromNode.y, toNode.x, toNode.y], {
        stroke: color,
        strokeWidth: 4,
        data: { type: 'cable', cableId: cable.id }
      });

      fabricCanvas.add(line);

      // Handle cable clicks for deletion
      line.on('mousedown', () => {
        if (selectedTool === 'delete') {
          onDeleteCable(cable.id);
        }
      });
    });

    fabricCanvas.renderAll();
  }, [fabricCanvas, cables, nodes, selectedTool, onDeleteCable]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex gap-2 p-4 bg-card border-b border-border">
        <Button
          variant={selectedTool === 'select' ? 'default' : 'tool'}
          size="tool"
          onClick={() => onToolChange('select')}
          className="flex flex-col gap-1"
        >
          <Move size={16} />
          <span className="text-xs">Sélection</span>
        </Button>
        
        <Button
          variant={selectedTool === 'addNode' ? 'default' : 'tool'}
          size="tool"
          onClick={() => onToolChange('addNode')}
          className="flex flex-col gap-1"
        >
          <Plus size={16} />
          <span className="text-xs">Nœud</span>
        </Button>
        
        <Button
          variant={selectedTool === 'addCable' ? 'default' : 'tool'}
          size="tool"
          onClick={() => onToolChange('addCable')}
          className="flex flex-col gap-1"
        >
          <CableIcon size={16} />
          <span className="text-xs">Câble</span>
        </Button>
        
        <Button
          variant={selectedTool === 'delete' ? 'destructive' : 'tool'}
          size="tool"
          onClick={() => onToolChange('delete')}
          className="flex flex-col gap-1"
        >
          <Trash2 size={16} />
          <span className="text-xs">Supprimer</span>
        </Button>
      </div>

      {/* Canvas */}
      <div className="flex-1 bg-muted/20 p-4">
        <div className="bg-white border border-border rounded-lg shadow-lg overflow-hidden">
          <canvas ref={canvasRef} className="block" />
        </div>
      </div>

      {/* Instructions */}
      <div className="p-4 bg-muted/50 border-t border-border">
        <p className="text-sm text-muted-foreground">
          {selectedTool === 'select' && "Mode sélection - Cliquez et glissez pour déplacer les éléments"}
          {selectedTool === 'addNode' && "Mode ajout de nœud - Cliquez sur le canvas pour ajouter un nœud"}
          {selectedTool === 'addCable' && "Mode ajout de câble - Cliquez sur deux nœuds pour les relier"}
          {selectedTool === 'delete' && "Mode suppression - Cliquez sur un élément pour le supprimer"}
        </p>
      </div>
    </div>
  );
};
