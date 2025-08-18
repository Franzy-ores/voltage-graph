import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import { useNetworkStore } from '@/store/networkStore';
import { Cable, Node } from '@/types/network';

// Fix for default markers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

export const MapView = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const cablesRef = useRef<Map<string, L.Polyline>>(new Map());
  
  const {
    currentProject,
    selectedTool,
    addNode,
    addCable,
    setSelectedNode,
    setSelectedCable,
    selectedNodeId,
    openEditPanel,
    calculationResults,
    selectedScenario
  } = useNetworkStore();

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current).setView([50.4674, 4.8720], 13); // Bruxelles par défaut

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Handle map clicks
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (selectedTool === 'addNode') {
        const connectionType = currentProject?.voltageSystem === 'TRIPHASÉ_230V' 
          ? 'TRI_230V_3F' 
          : 'TÉTRA_3P+N_230_400V';
        addNode(e.latlng.lat, e.latlng.lng, connectionType);
      }
    };

    map.on('click', handleMapClick);

    return () => {
      map.off('click', handleMapClick);
    };
  }, [selectedTool, currentProject, addNode]);

  // Update markers when nodes change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !currentProject) return;

    // Clear existing markers
    markersRef.current.forEach(marker => map.removeLayer(marker));
    markersRef.current.clear();

    // Add new markers
    currentProject.nodes.forEach(node => {
      const icon = L.divIcon({
        className: 'custom-node-marker',
        html: `<div class="w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold ${
          node.isSource 
            ? 'bg-primary border-primary text-primary-foreground' 
            : 'bg-secondary border-secondary-foreground text-secondary-foreground'
        }">${node.isSource ? 'S' : 'N'}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const marker = L.marker([node.lat, node.lng], { icon })
        .addTo(map)
        .bindPopup(node.name);

      marker.on('click', () => {
        if (selectedTool === 'addCable' && selectedNodeId && selectedNodeId !== node.id) {
          // Create cable between selected node and clicked node
          const nodeA = currentProject.nodes.find(n => n.id === selectedNodeId);
          if (nodeA) {
            const coordinates = [
              { lat: nodeA.lat, lng: nodeA.lng },
              { lat: node.lat, lng: node.lng }
            ];
            addCable(selectedNodeId, node.id, currentProject.cableTypes[0].id, coordinates);
            setSelectedNode(null);
          }
        } else if (selectedTool === 'addCable') {
          setSelectedNode(node.id);
        } else if (selectedTool === 'edit') {
          setSelectedNode(node.id);
          openEditPanel('node');
        }
      });

      markersRef.current.set(node.id, marker);
    });
  }, [currentProject?.nodes, selectedTool, selectedNodeId, addCable, setSelectedNode, openEditPanel]);

  // Update cables when cables change or calculation results change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !currentProject) return;

    // Clear existing cables
    cablesRef.current.forEach(cable => map.removeLayer(cable));
    cablesRef.current.clear();

    // Get current calculation results
    const results = calculationResults[selectedScenario];
    const calculatedCables = results?.cables || [];

    // Add new cables
    currentProject.cables.forEach(cable => {
      const calculatedCable = calculatedCables.find(c => c.id === cable.id);
      const voltageDropPercent = calculatedCable?.voltageDropPercent || 0;
      
      // Determine color based on voltage drop
      let color = 'hsl(var(--muted-foreground))'; // Default gray
      if (calculatedCable) {
        const absPercent = Math.abs(voltageDropPercent);
        if (absPercent < 8) color = 'hsl(142, 76%, 36%)'; // Green
        else if (absPercent < 10) color = 'hsl(32, 95%, 44%)'; // Orange
        else color = 'hsl(0, 84%, 60%)'; // Red
      }

      const polyline = L.polyline(
        cable.coordinates.map(coord => [coord.lat, coord.lng]),
        { 
          color,
          weight: 4,
          opacity: 0.8
        }
      ).addTo(map);

      const nodeA = currentProject.nodes.find(n => n.id === cable.nodeAId);
      const nodeB = currentProject.nodes.find(n => n.id === cable.nodeBId);
      
      polyline.bindPopup(`
        <div>
          <strong>${cable.name}</strong><br/>
          ${nodeA?.name} → ${nodeB?.name}<br/>
          Longueur: ${Math.round(cable.length_m || 0)}m<br/>
          ${calculatedCable ? `
            Intensité: ${calculatedCable.current_A?.toFixed(1)}A<br/>
            Chute: ${voltageDropPercent.toFixed(2)}%<br/>
            Pertes: ${calculatedCable.losses_kW?.toFixed(3)}kW
          ` : 'Non calculé'}
        </div>
      `);

      polyline.on('click', () => {
        if (selectedTool === 'edit') {
          setSelectedCable(cable.id);
          openEditPanel('cable');
        }
      });

      cablesRef.current.set(cable.id, polyline);
    });
  }, [currentProject?.cables, calculationResults, selectedScenario, selectedTool, setSelectedCable, openEditPanel]);

  return (
    <div className="flex-1 relative">
      <div ref={mapRef} className="w-full h-full" />
      
      {/* Tool indicator */}
      <div className="absolute top-4 left-4 bg-background/90 backdrop-blur-sm border rounded-lg px-3 py-2 text-sm">
        {selectedTool === 'addNode' && 'Cliquez pour ajouter un nœud'}
        {selectedTool === 'addCable' && !selectedNodeId && 'Cliquez sur le premier nœud'}
        {selectedTool === 'addCable' && selectedNodeId && 'Cliquez sur le second nœud'}
        {selectedTool === 'edit' && 'Cliquez sur un élément pour l\'éditer'}
        {selectedTool === 'select' && 'Mode sélection'}
      </div>
    </div>
  );
};
