import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import { useNetworkStore } from '@/store/networkStore';
import { Cable, Node } from '@/types/network';
import { VoltageDisplay } from './VoltageDisplay';
import { ElectricalCalculator } from '@/utils/electricalCalculations';

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
  const voltageMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  
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
    selectedScenario,
    deleteNode,
    deleteCable,
    showVoltages
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
    voltageMarkersRef.current.forEach(marker => map.removeLayer(marker));
    voltageMarkersRef.current.clear();

    // Add new markers
    currentProject.nodes.forEach(node => {
      // Determine icon based on node type and content
      let iconContent = 'N';
      let iconClass = 'bg-secondary border-secondary-foreground text-secondary-foreground';
      
      if (node.isSource) {
        iconContent = 'S';
        iconClass = 'bg-primary border-primary text-primary-foreground';
      } else {
        const hasProduction = node.productions.length > 0 && node.productions.some(p => p.S_kVA > 0);
        const hasLoad = node.clients.length > 0 && node.clients.some(c => c.S_kVA > 0);
        
        if (hasProduction && hasLoad) {
          iconContent = 'M'; // Mixte
          iconClass = 'bg-yellow-500 border-yellow-600 text-white';
        } else if (hasProduction) {
          iconContent = 'P'; // Production
          iconClass = 'bg-green-500 border-green-600 text-white';
        } else if (hasLoad) {
          iconContent = 'C'; // Charge
          iconClass = 'bg-blue-500 border-blue-600 text-white';
        }
      }

      // Calculate voltage for this node if calculations exist
      let voltageText = '';
      if (showVoltages && calculationResults[selectedScenario] && !node.isSource) {
        const results = calculationResults[selectedScenario];
        const baseVoltage = node.connectionType.includes('230V') ? 230 : 400;
        const incomingCable = results?.cables.find(c => c.nodeBId === node.id);
        let nodeVoltage = baseVoltage;
        
        if (incomingCable) {
          nodeVoltage = baseVoltage - (incomingCable.voltageDrop_V || 0);
        }
        voltageText = `<div class="text-[10px] leading-tight">${nodeVoltage.toFixed(0)}V</div>`;
      }

      const icon = L.divIcon({
        className: 'custom-node-marker',
        html: `<div class="w-8 h-8 rounded-full border-2 flex flex-col items-center justify-center text-xs font-bold ${iconClass}">
          <div class="text-xs">${iconContent}</div>
          ${voltageText}
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
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
        } else if (selectedTool === 'delete') {
          if (confirm(`Supprimer le nœud "${node.name}" ?`)) {
            deleteNode(node.id);
          }
        }
      });

      markersRef.current.set(node.id, marker);
    });
  }, [currentProject?.nodes, selectedTool, selectedNodeId, addCable, setSelectedNode, openEditPanel, showVoltages, calculationResults, selectedScenario]);

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
        } else if (selectedTool === 'delete') {
          if (confirm(`Supprimer le câble "${cable.name}" ?`)) {
            deleteCable(cable.id);
          }
        }
      });

      cablesRef.current.set(cable.id, polyline);
    });
  }, [currentProject?.cables, calculationResults, selectedScenario, selectedTool, setSelectedCable, openEditPanel]);

  return (
    <div className="flex-1 relative">
      <div ref={mapRef} className="w-full h-full" />
      
      <VoltageDisplay />
      
      {/* Tool indicator */}
      <div className="absolute top-4 left-4 bg-background/90 backdrop-blur-sm border rounded-lg px-3 py-2 text-sm">
        {selectedTool === 'addNode' && 'Cliquez pour ajouter un nœud'}
        {selectedTool === 'addCable' && !selectedNodeId && 'Cliquez sur le premier nœud'}
        {selectedTool === 'addCable' && selectedNodeId && 'Cliquez sur le second nœud'}
        {selectedTool === 'edit' && 'Cliquez sur un élément pour l\'éditer'}
        {selectedTool === 'delete' && 'Cliquez sur un élément pour le supprimer'}
        {selectedTool === 'select' && 'Mode sélection'}
      </div>
    </div>
  );
};
