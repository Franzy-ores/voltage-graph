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
  const [routingActive, setRoutingActive] = useState(false);
  const [routingFromNode, setRoutingFromNode] = useState<string | null>(null);
  const [routingToNode, setRoutingToNode] = useState<string | null>(null);
  const [routingPoints, setRoutingPoints] = useState<{ lat: number; lng: number }[]>([]);
  const tempMarkersRef = useRef<L.Marker[]>([]);
  const tempLineRef = useRef<L.Polyline | null>(null);
  
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

  // Handle map clicks for adding nodes and routing
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (selectedTool === 'addNode' && !routingActive) {
        addNode(e.latlng.lat, e.latlng.lng, 'MONO_230V_PN');
      } else if (routingActive) {
        // Vérifier si on clique près du nœud de destination pour finaliser
        if (routingToNode) {
          const toNode = currentProject?.nodes.find(n => n.id === routingToNode);
          if (toNode) {
            const distance = map.distance([e.latlng.lat, e.latlng.lng], [toNode.lat, toNode.lng]);
            if (distance < 50) {
              // Finaliser le routage
              console.log('Finalizing underground cable routing');
              const finalCoords = [...routingPoints, { lat: toNode.lat, lng: toNode.lng }];
              if (routingFromNode) {
                addCable(routingFromNode, routingToNode, selectedCableType, finalCoords);
              }
              clearRouting();
              return;
            }
          }
        }
        
        // Ajouter un point intermédiaire
        const newPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
        setRoutingPoints(prev => [...prev, newPoint]);
        console.log('Added routing point:', newPoint);
        
        // Ajouter un marqueur temporaire
        const marker = L.marker([e.latlng.lat, e.latlng.lng], {
          icon: L.divIcon({
            className: 'routing-point',
            html: '<div class="w-3 h-3 bg-blue-500 border border-white rounded-full"></div>',
            iconSize: [12, 12],
            iconAnchor: [6, 6]
          })
        }).addTo(map);
        
        tempMarkersRef.current.push(marker);
        updateTempLine();
      }
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [selectedTool, addNode, routingActive, routingPoints, routingFromNode, routingToNode, selectedCableType, currentProject]);

  // Gérer les touches clavier pendant le routage
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && routingActive) {
        clearRouting();
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [routingActive]);

  // Fonction pour mettre à jour la ligne temporaire
  const updateTempLine = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    
    if (tempLineRef.current) {
      map.removeLayer(tempLineRef.current);
    }
    
    if (routingPoints.length > 1) {
      tempLineRef.current = L.polyline(
        routingPoints.map(p => [p.lat, p.lng]),
        { 
          color: '#3b82f6', 
          weight: 3, 
          opacity: 0.7,
          dashArray: '5, 5'
        }
      ).addTo(map);
    }
  };

  // Fonction pour nettoyer le routage
  const clearRouting = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    
    // Nettoyer les marqueurs temporaires
    tempMarkersRef.current.forEach(marker => {
      try {
        map.removeLayer(marker);
      } catch (e) {
        console.warn('Error removing marker:', e);
      }
    });
    tempMarkersRef.current = [];
    
    // Nettoyer la ligne temporaire
    if (tempLineRef.current) {
      try {
        map.removeLayer(tempLineRef.current);
      } catch (e) {
        console.warn('Error removing line:', e);
      }
      tempLineRef.current = null;
    }
    
    // Réinitialiser l'état
    setRoutingActive(false);
    setRoutingFromNode(null);
    setRoutingToNode(null);
    setRoutingPoints([]);
    setSelectedNode(null);
  };

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
        console.log('Node clicked:', { nodeId: node.id, selectedTool, selectedNodeId, routingActive });
        
        if (routingActive && routingToNode === node.id) {
          // Finaliser le routage en cliquant sur le nœud de destination
          console.log('Finalizing route at destination node');
          const finalCoords = [...routingPoints, { lat: node.lat, lng: node.lng }];
          if (routingFromNode) {
            addCable(routingFromNode, node.id, selectedCableType, finalCoords);
          }
          clearRouting();
          return;
        }
        
        if (selectedTool === 'addCable' && selectedNodeId && selectedNodeId !== node.id && !routingActive) {
          // Vérifier le type de câble pour décider du comportement
          const cableType = currentProject?.cableTypes.find(ct => ct.id === selectedCableType);
          const isUnderground = cableType?.posesPermises.includes('SOUTERRAIN') && !cableType?.posesPermises.includes('AÉRIEN');
          
          if (isUnderground) {
            // Démarrer le routage manuel pour câble souterrain
            console.log('Starting underground cable routing from', selectedNodeId, 'to', node.id);
            const fromNode = currentProject.nodes.find(n => n.id === selectedNodeId);
            if (fromNode) {
              setRoutingFromNode(selectedNodeId);
              setRoutingToNode(node.id);
              setRoutingPoints([{ lat: fromNode.lat, lng: fromNode.lng }]);
              setRoutingActive(true);
              
              // Ajouter les marqueurs de départ et d'arrivée
              const map = mapInstanceRef.current;
              if (map) {
                const startMarker = L.marker([fromNode.lat, fromNode.lng], {
                  icon: L.divIcon({
                    className: 'routing-start',
                    html: '<div class="w-4 h-4 bg-green-500 border border-white rounded-full"></div>',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                  })
                }).addTo(map);
                
                const endMarker = L.marker([node.lat, node.lng], {
                  icon: L.divIcon({
                    className: 'routing-end',
                    html: '<div class="w-4 h-4 bg-red-500 border border-white rounded-full"></div>',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                  })
                }).addTo(map);
                
                tempMarkersRef.current.push(startMarker, endMarker);
              }
            }
          } else {
            // Câble aérien : connexion directe
            console.log('Creating direct aerial cable from', selectedNodeId, 'to', node.id);
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
          }
          
        } else if (selectedTool === 'addCable' && !routingActive) {
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
        {selectedTool === 'addCable' && !selectedNodeId && !routingActive && 'Sélectionnez le type de câble puis cliquez sur le premier nœud'}
        {selectedTool === 'addCable' && selectedNodeId && !routingActive && 'Cliquez sur le second nœud'}
        {routingActive && 'Cliquez pour ajouter des points intermédiaires, puis cliquez sur le nœud rouge pour finaliser'}
        {selectedTool === 'edit' && 'Cliquez sur un élément pour l\'éditer'}
        {selectedTool === 'delete' && 'Cliquez sur un élément pour le supprimer'}
        {selectedTool === 'select' && 'Mode sélection'}
      </div>
      
      {/* Bouton d'annulation pendant le routage */}
      {routingActive && (
        <div className="absolute top-16 left-20 bg-red-500 text-white rounded-lg px-3 py-2 text-sm z-40">
          <button onClick={clearRouting} className="hover:bg-red-600 px-2 py-1 rounded">
            ❌ Annuler le routage (ESC)
          </button>
        </div>
      )}
    </div>
  );
};