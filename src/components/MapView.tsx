import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useNetworkStore } from '@/store/networkStore';
import { VoltageDisplay } from './VoltageDisplay';
import { CableTypeSelector } from './CableTypeSelector';

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
    selectedCableType,
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

    const map = L.map(mapRef.current).setView([50.4674, 4.8720], 13);

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

  // Handle map clicks for adding nodes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (selectedTool === 'addNode') {
        addNode(e.latlng.lat, e.latlng.lng, 'MONO_230V_PN');
      }
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [selectedTool, addNode]);

  // Update markers when nodes change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !currentProject) return;

    // Clear existing markers
    markersRef.current.forEach(marker => map.removeLayer(marker));
    markersRef.current.clear();

    // Add new markers
    currentProject.nodes.forEach(node => {
      let iconContent = 'N';
      let iconClass = 'bg-secondary border-secondary-foreground text-secondary-foreground';
      
      if (node.isSource) {
        iconContent = 'S';
        iconClass = 'bg-primary border-primary text-primary-foreground';
      }

      const icon = L.divIcon({
        className: 'custom-node-marker',
        html: `<div class="w-12 h-12 rounded-full border-2 flex items-center justify-center text-xs font-bold ${iconClass}">
          ${iconContent}
        </div>`,
        iconSize: [48, 48],
        iconAnchor: [24, 24]
      });

      const marker = L.marker([node.lat, node.lng], { icon })
        .addTo(map)
        .bindPopup(node.name);

      marker.on('click', () => {
        console.log('Node clicked:', { nodeId: node.id, selectedTool, selectedNodeId });
        
        if (selectedTool === 'addCable' && selectedNodeId && selectedNodeId !== node.id) {
          // Créer un câble entre les deux nœuds
          console.log('Creating cable from', selectedNodeId, 'to', node.id);
          
          const fromNode = currentProject.nodes.find(n => n.id === selectedNodeId);
          const toNode = currentProject.nodes.find(n => n.id === node.id);
          
          if (fromNode && toNode) {
            const coordinates = [
              { lat: fromNode.lat, lng: fromNode.lng },
              { lat: toNode.lat, lng: toNode.lng }
            ];
            addCable(selectedNodeId, node.id, selectedCableType, coordinates);
            setSelectedNode(null);
          }
          
        } else if (selectedTool === 'addCable') {
          console.log('Selecting first node:', node.id);
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
  }, [currentProject?.nodes, selectedTool, selectedNodeId, selectedCableType, addCable, setSelectedNode, openEditPanel, deleteNode]);

  // Update cables
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !currentProject) return;

    cablesRef.current.forEach(cable => map.removeLayer(cable));
    cablesRef.current.clear();

    currentProject.cables.forEach(cable => {
      const polyline = L.polyline(
        cable.coordinates.map(coord => [coord.lat, coord.lng]),
        { 
          color: '#3b82f6',
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
          Longueur: ${Math.round(cable.length_m || 0)}m
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
  }, [currentProject?.cables, selectedTool, setSelectedCable, openEditPanel, deleteCable]);

  return (
    <div className="flex-1 relative">
      <div ref={mapRef} className="w-full h-full" />
      
      <VoltageDisplay />
      <CableTypeSelector />
      
      {/* Tool indicator */}
      <div className="absolute top-4 left-20 bg-background/90 backdrop-blur-sm border rounded-lg px-3 py-2 text-sm z-40">
        {selectedTool === 'addNode' && 'Cliquez pour ajouter un nœud'}
        {selectedTool === 'addCable' && !selectedNodeId && 'Sélectionnez le type de câble puis cliquez sur le premier nœud'}
        {selectedTool === 'addCable' && selectedNodeId && 'Cliquez sur le second nœud'}
        {selectedTool === 'edit' && 'Cliquez sur un élément pour l\'éditer'}
        {selectedTool === 'delete' && 'Cliquez sur un élément pour le supprimer'}
        {selectedTool === 'select' && 'Mode sélection'}
      </div>
    </div>
  );
};