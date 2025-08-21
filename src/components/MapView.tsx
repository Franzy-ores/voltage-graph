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
  const [routingActive, setRoutingActive] = useState(false);
  const [routingFromNode, setRoutingFromNode] = useState<string | null>(null);
  const [routingToNode, setRoutingToNode] = useState<string | null>(null);
  const routingPointsRef = useRef<{ lat: number; lng: number }[]>([]);
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
    showVoltages,
    moveNode,
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

  // Handle map clicks for adding nodes and routing
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (selectedTool === 'addNode' && !routingActive) {
        addNode(e.latlng.lat, e.latlng.lng, 'MONO_230V_PN');
      } else if (routingActive) {
        // En mode routage, ajouter des points intermédiaires
        const newPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
        routingPointsRef.current = [...routingPointsRef.current, newPoint];
        
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

    const handleMapDoubleClick = (e: L.LeafletMouseEvent) => {
      if (routingActive) {
        // Double-clic : finaliser le routage à cette position
        const finalPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
        const finalCoords = [...routingPointsRef.current, finalPoint];
        
        if (routingFromNode && finalCoords.length >= 2) {
          // Utiliser routingToNode si défini, sinon créer un nœud temporaire
          const destinationNodeId = routingToNode || routingFromNode;
          addCable(routingFromNode, destinationNodeId, selectedCableType, finalCoords);
          clearRouting();
        }
      }
    };

    map.on('click', handleMapClick);
    map.on('dblclick', handleMapDoubleClick);
    return () => {
      map.off('click', handleMapClick);
      map.off('dblclick', handleMapDoubleClick);
    };
  }, [selectedTool, addNode, routingActive, routingFromNode, routingToNode, selectedCableType, addCable]);

  // Gérer les touches clavier pendant le routage
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && routingActive) {
        clearRouting();
      } else if (e.key === 'Enter' && routingActive) {
        // Enter : finaliser le routage au dernier point ajouté
        if (routingFromNode && routingPointsRef.current.length >= 2) {
          // Utiliser routingToNode si défini, sinon créer un point final avec les dernières coordonnées
          const targetNodeId = routingToNode || `temp-${Date.now()}`;
          const lastPoint = routingPointsRef.current[routingPointsRef.current.length - 1];
          const finalCoords = [...routingPointsRef.current];
          
          if (routingToNode) {
            addCable(routingFromNode, routingToNode, selectedCableType, finalCoords);
          } else {
            // Créer un câble qui se termine au dernier point cliqué
            const finalCoords = [...routingPointsRef.current];
            if (finalCoords.length >= 2) {
              addCable(routingFromNode, routingFromNode, selectedCableType, finalCoords);
            }
          }
          clearRouting();
        }
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [routingActive, routingFromNode, routingToNode, selectedCableType, addCable]);

  // Fonction pour mettre à jour la ligne temporaire
  const updateTempLine = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    
    if (tempLineRef.current) {
      map.removeLayer(tempLineRef.current);
    }
    
    if (routingPointsRef.current.length > 1) {
      tempLineRef.current = L.polyline(
        routingPointsRef.current.map(p => [p.lat, p.lng]),
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
    routingPointsRef.current = [];
    setSelectedNode(null);
  };
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !currentProject) return;

    // Clear existing markers
    markersRef.current.forEach(marker => map.removeLayer(marker));
    markersRef.current.clear();

    // Add new markers
    currentProject.nodes.forEach(node => {
      // Calculer les totaux
      const totalCharge = node.clients.reduce((sum, client) => sum + client.S_kVA, 0);
      const totalPV = node.productions.reduce((sum, prod) => sum + prod.S_kVA, 0);
      
      // Calculer la tension avec chute cumulée selon le type de connexion
      let baseVoltage = 230; // Par défaut
      
      // Déterminer la tension de base selon le type de connexion du nœud
      switch (node.connectionType) {
        case 'TÉTRA_3P+N_230_400V':
          baseVoltage = 400;
          break;
        case 'MONO_230V_PN':
        case 'MONO_230V_PP':
        case 'TRI_230V_3F':
          baseVoltage = 230;
          break;
        default:
          baseVoltage = 230;
          break;
      }
      
      let nodeVoltage = baseVoltage;
      let isOutOfCompliance = false;
      
      if (calculationResults[selectedScenario] && !node.isSource) {
        const results = calculationResults[selectedScenario];
        const nodeData = results.nodeVoltageDrops?.find(n => n.nodeId === node.id);
        if (nodeData) {
          // Utiliser la chute de tension cumulée SIGNÉE (+ = chute, - = hausse)
          nodeVoltage = baseVoltage - nodeData.deltaU_cum_V;
          // Vérifier la conformité EN50160 (seuil à 10%)
          isOutOfCompliance = Math.abs(nodeData.deltaU_cum_percent) > 10;
        }
      }
      
      // Déterminer le type et l'icône
      let iconContent = 'N';
      let iconClass = 'bg-secondary border-secondary-foreground text-secondary-foreground';
      
      if (node.isSource) {
        iconContent = 'S';
        // Source colorée selon la tension du système
        const isHighVoltage = currentProject.voltageSystem === 'TÉTRAPHASÉ_400V';
        iconClass = isHighVoltage ? 'bg-green-500 border-green-600 text-white' : 'bg-blue-500 border-blue-600 text-white';
      } else {
        const hasProduction = totalPV > 0;
        const hasLoad = totalCharge > 0;
        
        if (hasProduction && hasLoad) {
          iconContent = 'M'; // Mixte
          iconClass = isOutOfCompliance ? 'bg-red-500 border-red-600 text-white' : 'bg-yellow-500 border-yellow-600 text-white';
        } else if (hasProduction) {
          iconContent = 'P'; // Production seule
          iconClass = isOutOfCompliance ? 'bg-red-500 border-red-600 text-white' : 'bg-green-500 border-green-600 text-white';
        } else if (hasLoad) {
          iconContent = 'C'; // Charge seule
          iconClass = isOutOfCompliance ? 'bg-red-500 border-red-600 text-white' : 'bg-blue-500 border-blue-600 text-white';
        }
      }

      const icon = L.divIcon({
        className: 'custom-node-marker',
        html: `<div class="w-12 h-12 rounded-full border-2 flex flex-col items-center justify-center text-xs font-bold ${iconClass} p-1">
          <div class="text-sm">${iconContent}</div>
          ${showVoltages ? `<div class="text-[8px] leading-tight text-center">
            <div class="font-bold">${Math.round(nodeVoltage)}V</div>
            ${!node.isSource ? `<div>C:${totalCharge}</div>` : ''}
            ${!node.isSource ? `<div>PV:${totalPV}</div>` : ''}
          </div>` : ''}
        </div>`,
        iconSize: [48, 48],
        iconAnchor: [24, 24]
      });

      const marker = L.marker([node.lat, node.lng], { 
        icon,
        draggable: selectedTool === 'move'
      })
        .addTo(map)
        .bindPopup(node.name);

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        
        // Si on est en mode routage, cliquer sur n'importe quel nœud termine le tracé
        if (routingActive) {
          const finalCoords = [...routingPointsRef.current, { lat: node.lat, lng: node.lng }];
          
          if (routingFromNode && finalCoords.length >= 2) {
            addCable(routingFromNode, node.id, selectedCableType, finalCoords);
            clearRouting();
          }
          return;
        }
        
        if (selectedTool === 'select') {
          setSelectedNode(node.id);
          openEditPanel('node');
        } else if (selectedTool === 'addCable' && selectedNodeId && selectedNodeId !== node.id) {
          // Vérifier le type de câble pour décider du comportement
          const cableType = currentProject?.cableTypes.find(ct => ct.id === selectedCableType);
          const isUnderground = cableType?.posesPermises.includes('SOUTERRAIN') && !cableType?.posesPermises.includes('AÉRIEN');
          
          if (isUnderground) {
            // Démarrer le routage manuel pour câble souterrain
            const fromNode = currentProject.nodes.find(n => n.id === selectedNodeId);
            if (fromNode) {
              setRoutingFromNode(selectedNodeId);
              setRoutingToNode(node.id);
              // Initialiser routingPoints avec le point de départ
              const initialPoints = [{ lat: fromNode.lat, lng: fromNode.lng }];
              routingPointsRef.current = initialPoints;
              setRoutingActive(true);
              
              // Ajouter uniquement le marqueur de départ
              const map = mapInstanceRef.current;
              if (map) {
                const startMarker = L.marker([fromNode.lat, fromNode.lng], {
                  icon: L.divIcon({
                    className: 'routing-start',
                    html: '<div class="w-4 h-4 bg-green-500 border-2 border-white rounded-full"></div>',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                  })
                }).addTo(map);
                
                tempMarkersRef.current.push(startMarker);
              }
            }
          } else {
            // Câble aérien : connexion directe
            const fromNode = currentProject.nodes.find(n => n.id === selectedNodeId);
            if (fromNode) {
              const coordinates = [
                { lat: fromNode.lat, lng: fromNode.lng },
                { lat: node.lat, lng: node.lng }
              ];
              addCable(selectedNodeId, node.id, selectedCableType, coordinates);
              setSelectedNode(null);
            }
          }
        } else if (selectedTool === 'addCable') {
          setSelectedNode(node.id);
        } else if (selectedTool === 'edit') {
          setSelectedNode(node.id);
          openEditPanel('node');
        } else if (selectedTool === 'move') {
          // Le nœud est maintenant sélectionné pour déplacement
          setSelectedNode(node.id);
        } else if (selectedTool === 'delete') {
          if (confirm(`Supprimer le nœud "${node.name}" ?`)) {
            deleteNode(node.id);
          }
        }
      });

      // Gestionnaire pour le drag & drop
      marker.on('dragend', (e) => {
        const newLatLng = e.target.getLatLng();
        moveNode(node.id, newLatLng.lat, newLatLng.lng);
      });

      markersRef.current.set(node.id, marker);
    });
  }, [currentProject?.nodes, selectedTool, selectedNodeId, selectedCableType, addCable, setSelectedNode, openEditPanel, deleteNode, showVoltages, calculationResults, selectedScenario, moveNode]);

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
        } else if (selectedTool === 'edit') {
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
        {selectedTool === 'addCable' && !selectedNodeId && !routingActive && 'Sélectionnez le premier nœud'}
        {selectedTool === 'addCable' && selectedNodeId && !routingActive && 'Cliquez sur le second nœud'}
        {routingActive && 'Ajoutez des points intermédiaires en cliquant. Finalisez avec : double-clic, Enter, ou clic sur un nœud'}
        {selectedTool === 'select' && 'Cliquez sur un élément pour le sélectionner'}
        {selectedTool === 'edit' && 'Cliquez sur un élément pour l\'éditer'}
        {selectedTool === 'move' && 'Cliquez et glissez un nœud pour le déplacer'}
        {selectedTool === 'delete' && 'Cliquez sur un élément pour le supprimer'}
      </div>
      
      {/* Bouton d'annulation pendant le routage */}
      {routingActive && (
        <div className="absolute top-16 left-20 bg-red-500 text-white rounded-lg px-3 py-2 text-sm z-40">
          <button onClick={clearRouting} className="hover:bg-red-600 px-2 py-1 rounded">
            ❌ Annuler (ESC) | ✅ Finir (Enter/Double-clic)
          </button>
        </div>
      )}
    </div>
  );
};