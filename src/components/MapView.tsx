import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useNetworkStore } from '@/store/networkStore';
import { VoltageDisplay } from './VoltageDisplay';
import { CableTypeSelector } from './CableTypeSelector';
import { AddressSearch } from './AddressSearch';
import { Button } from './ui/button';
import { Globe, Map as MapIcon } from 'lucide-react';

// Configuration des icônes Leaflet
const configureLeafletIcons = () => {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconUrl: '/leaflet/marker-icon.png',
    iconRetinaUrl: '/leaflet/marker-icon-2x.png', 
    shadowUrl: '/leaflet/marker-shadow.png',
  });
};

let iconsConfigured = false;

export const MapView = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map<string, L.Marker>());
  const cablesRef = useRef<Map<string, L.Polyline>>(new Map<string, L.Polyline>());
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [mapType, setMapType] = useState<'osm' | 'satellite'>('osm');
  
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
    showVoltages,
  } = useNetworkStore();

  // Fonction pour zoomer sur le projet chargé
  const zoomToProject = () => {
    const map = mapInstanceRef.current;
    if (!map || !currentProject || currentProject.nodes.length === 0) return;

    const bounds = L.latLngBounds(
      currentProject.nodes.map(node => [node.lat, node.lng])
    );
    
    const paddedBounds = bounds.pad(0.1);
    map.fitBounds(paddedBounds);
  };

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    if (!iconsConfigured) {
      configureLeafletIcons();
      iconsConfigured = true;
    }

    const map = L.map(mapRef.current, {
      center: [49.85, 5.40],
      zoom: 10,
      zoomControl: true,
      attributionControl: true,
    });

    const initialTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18,
      minZoom: 3,
    }).addTo(map);

    tileLayerRef.current = initialTileLayer;
    mapInstanceRef.current = map;

    const handleZoomToProject = () => {
      zoomToProject();
    };

    window.addEventListener('zoomToProject', handleZoomToProject);

    return () => {
      window.removeEventListener('zoomToProject', handleZoomToProject);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Gérer le changement de type de carte
  const switchMapType = (newType: 'osm' | 'satellite') => {
    const map = mapInstanceRef.current;
    if (!map || !tileLayerRef.current) return;

    map.removeLayer(tileLayerRef.current);

    if (newType === 'osm') {
      tileLayerRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
        minZoom: 3,
      }).addTo(map);
    } else {
      tileLayerRef.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        maxZoom: 18,
        minZoom: 3,
      }).addTo(map);
    }

    setMapType(newType);
  };

  // Gérer la sélection d'adresse
  const handleLocationSelect = (lat: number, lng: number, address: string) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    map.setView([lat, lng], 16);
    
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'search-result-marker',
        html: '<div class="w-6 h-6 bg-red-500 border-2 border-white rounded-full shadow-lg"></div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
    }).addTo(map);

    setTimeout(() => {
      try {
        map.removeLayer(marker);
      } catch (e) {
        console.warn('Marker already removed');
      }
    }, 3000);
  };

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
      // Déterminer le type et l'icône
      let iconContent = 'N';
      let iconClass = 'bg-blue-500 border-blue-600 text-white';
      
      if (node.isSource) {
        iconContent = 'S';
        iconClass = 'bg-green-500 border-green-600 text-white';
      }

      const icon = L.divIcon({
        className: 'custom-node-marker',
        html: `<div class="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-bold ${iconClass}">
          ${iconContent}
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker([node.lat, node.lng], { icon })
        .addTo(map)
        .bindPopup(node.name);

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        
        if (selectedTool === 'select') {
          setSelectedNode(node.id);
          openEditPanel('node');
        } else if (selectedTool === 'addCable' && selectedNodeId && selectedNodeId !== node.id) {
          // Créer un câble direct entre les deux nœuds
          const fromNode = currentProject.nodes.find(n => n.id === selectedNodeId);
          if (fromNode) {
            const coordinates = [
              { lat: fromNode.lat, lng: fromNode.lng },
              { lat: node.lat, lng: node.lng }
            ];
            addCable(selectedNodeId, node.id, selectedCableType, coordinates);
            setSelectedNode(null);
          }
        } else if (selectedTool === 'addCable') {
          setSelectedNode(node.id);
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
      let cableColor = '#6b7280'; // gris par défaut
      const results = calculationResults[selectedScenario];
      if (results) {
        const calculatedCable = results.cables.find(c => c.id === cable.id);
        if (calculatedCable) {
          const distalNodeId = calculatedCable.nodeBId;
          const nodeData = results.nodeVoltageDrops?.find(n => n.nodeId === distalNodeId);
          
          if (nodeData) {
            const absDropPercent = Math.abs(nodeData.deltaU_cum_percent);
            if (absDropPercent <= 8) {
              cableColor = '#22c55e'; // vert - normal
            } else if (absDropPercent <= 10) {
              cableColor = '#f59e0b'; // orange - warning  
            } else {
              cableColor = '#ef4444'; // rouge - critical
            }
          }
        }
      }
      
      const polyline = L.polyline(
        cable.coordinates.map(coord => [coord.lat, coord.lng]),
        { 
          color: cableColor,
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
        if (selectedTool === 'select') {
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
  }, [currentProject?.cables, selectedTool, setSelectedCable, openEditPanel, deleteCable, calculationResults, selectedScenario]);

  return (
    <div className="flex-1 relative">
      <div 
        ref={mapRef} 
        className="w-full h-full"
        style={{
          position: 'relative',
          zIndex: 0,
          backgroundColor: '#f0f0f0'
        }}
      />
      
      {/* Barre de recherche d'adresse */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000]">
        <AddressSearch onLocationSelect={handleLocationSelect} />
      </div>
      
      {/* Sélecteur de type de carte */}
      <div className="absolute bottom-4 right-4 z-[1000] flex flex-col gap-2">
        <Button
          variant={mapType === 'osm' ? 'default' : 'outline'}
          size="sm"
          onClick={() => switchMapType('osm')}
          className="flex items-center gap-2"
        >
          <MapIcon className="w-4 h-4" />
          Plan
        </Button>
        <Button
          variant={mapType === 'satellite' ? 'default' : 'outline'}
          size="sm"
          onClick={() => switchMapType('satellite')}
          className="flex items-center gap-2"
        >
          <Globe className="w-4 h-4" />
          Satellite
        </Button>
      </div>
      
      <VoltageDisplay />
      <CableTypeSelector />
      
      {/* Tool indicator */}
      <div className="absolute top-4 left-20 bg-background/90 backdrop-blur-sm border rounded-lg px-3 py-2 text-sm z-40">
        {selectedTool === 'addNode' && 'Cliquez pour ajouter un nœud'}
        {selectedTool === 'addCable' && !selectedNodeId && 'Sélectionnez le premier nœud'}
        {selectedTool === 'addCable' && selectedNodeId && 'Cliquez sur le second nœud'}
        {selectedTool === 'select' && 'Cliquez sur un élément pour le sélectionner'}
        {selectedTool === 'delete' && 'Cliquez sur un élément pour le supprimer'}
      </div>
    </div>
  );
};