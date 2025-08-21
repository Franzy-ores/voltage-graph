import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useNetworkStore } from '@/store/networkStore';
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
  const zoomToProject = (event?: CustomEvent) => {
    const map = mapInstanceRef.current;
    if (!map || !currentProject) return;

    const bounds = event?.detail || currentProject.geographicBounds;
    
    if (bounds && bounds.center) {
      // Utiliser les bounds sauvegardés du projet
      map.setView([bounds.center.lat, bounds.center.lng], bounds.zoom);
    } else if (currentProject.nodes.length > 0) {
      // Fallback : calculer à partir des nœuds
      const latLngBounds = L.latLngBounds(
        currentProject.nodes.map(node => [node.lat, node.lng])
      );
      const paddedBounds = latLngBounds.pad(0.1);
      map.fitBounds(paddedBounds);
    }
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

    const handleZoomToProject = (event: Event) => {
      const customEvent = event as CustomEvent;
      zoomToProject(customEvent);
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
        console.log('=== ADDING INTERMEDIATE POINT ===');
        console.log('New point:', newPoint);
        console.log('Current routing points before adding:', routingPointsRef.current);
        routingPointsRef.current = [...routingPointsRef.current, newPoint];
        console.log('Current routing points after adding:', routingPointsRef.current);
        
        // Pas d'affichage de marqueurs temporaires comme demandé
        updateTempLine();
      }
    };

    const handleMapDoubleClick = (e: L.LeafletMouseEvent) => {
      if (routingActive) {
        // Double-clic : finaliser le routage à cette position en conservant tout le tracé
        const finalPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
        const finalCoords = [...routingPointsRef.current, finalPoint];
        
        if (routingFromNode && finalCoords.length >= 2) {
          if (routingToNode) {
            // Connecter au nœud de destination en conservant le tracé complet
            const destinationNode = currentProject?.nodes.find(n => n.id === routingToNode);
            if (destinationNode) {
              // Remplacer le dernier point par la position exacte du nœud de destination
              finalCoords[finalCoords.length - 1] = { lat: destinationNode.lat, lng: destinationNode.lng };
            }
            addCable(routingFromNode, routingToNode, selectedCableType, finalCoords);
          } else {
            // Créer un nœud au point final et connecter avec tout le tracé
            addNode(finalPoint.lat, finalPoint.lng, 'MONO_230V_PN');
            setTimeout(() => {
              const newNode = currentProject?.nodes[currentProject.nodes.length - 1];
              if (newNode) {
                addCable(routingFromNode, newNode.id, selectedCableType, finalCoords);
              }
            }, 10);
          }
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
        // Enter : finaliser le routage en conservant tout le tracé
        if (routingFromNode && routingPointsRef.current.length >= 2) {
          const finalCoords = [...routingPointsRef.current];
          
          if (routingToNode) {
            // Si on a un nœud de destination défini, s'assurer que le dernier point est sa position
            const destinationNode = currentProject?.nodes.find(n => n.id === routingToNode);
            if (destinationNode) {
              finalCoords[finalCoords.length - 1] = { lat: destinationNode.lat, lng: destinationNode.lng };
            }
            addCable(routingFromNode, routingToNode, selectedCableType, finalCoords);
          } else {
            // Créer un nœud temporaire au dernier point du tracé
            const lastPoint = finalCoords[finalCoords.length - 1];
            addNode(lastPoint.lat, lastPoint.lng, 'MONO_230V_PN');
            // Le nœud créé aura un ID généré, on doit le récupérer
            setTimeout(() => {
              const newNode = currentProject?.nodes[currentProject.nodes.length - 1];
              if (newNode) {
                addCable(routingFromNode, newNode.id, selectedCableType, finalCoords);
              }
            }, 10);
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

  // Fonction pour vérifier si un câble existe déjà entre deux nœuds
  const cableExistsBetweenNodes = (nodeA: string, nodeB: string): boolean => {
    if (!currentProject) return false;
    
    return currentProject.cables.some(cable => 
      (cable.nodeAId === nodeA && cable.nodeBId === nodeB) ||
      (cable.nodeAId === nodeB && cable.nodeBId === nodeA)
    );
  };

  // Fonction pour nettoyer le routage
  const clearRouting = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    
    console.log('=== CLEARING ROUTING STATE ===');
    console.log('Before clearing - routingActive:', routingActive);
    console.log('Before clearing - routingFromNode:', routingFromNode);
    console.log('Before clearing - selectedNodeId:', selectedNodeId);
    
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
    
    // Réinitialiser complètement l'état
    setRoutingActive(false);
    setRoutingFromNode(null);
    setRoutingToNode(null);
    routingPointsRef.current = [];
    setSelectedNode(null); // Important: remettre selectedNodeId à null
    
    console.log('=== ROUTING STATE CLEARED - ALL STATES RESET ===');
    console.log('routingActive should be false, routingFromNode should be null');
    console.log('Ready for completely new cable routing process');
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
        html: `<div class="w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center text-xs font-bold ${iconClass} p-1">
          <div class="text-sm">${iconContent}</div>
          ${showVoltages ? `<div class="text-[8px] leading-tight text-center">
            <div class="font-bold">${Math.round(nodeVoltage)}V</div>
            ${!node.isSource ? `<div>C:${totalCharge}</div>` : ''}
            ${!node.isSource ? `<div>PV:${totalPV}</div>` : ''}
          </div>` : ''}
        </div>`,
        iconSize: [56, 56],
        iconAnchor: [28, 28]
      });

      const marker = L.marker([node.lat, node.lng], { 
        icon,
        draggable: selectedTool === 'move'
      })
        .addTo(map)
        .bindPopup(node.name);

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        
        // MODE ROUTAGE ACTIF: Finaliser le tracé sur n'importe quel nœud
        if (routingActive && routingFromNode) {
          console.log('=== FINALIZING CABLE ON NODE CLICK ===');
          console.log('Finalizing from', routingFromNode, 'to', node.id);
          console.log('Routing points:', routingPointsRef.current);
          
          // VÉRIFICATION CRITIQUE : S'assurer qu'on a vraiment des points de routage
          if (routingPointsRef.current.length === 0) {
            console.log('ERROR: No routing points found, ignoring finalization');
            return;
          }
          
          // VÉRIFICATION : Empêcher la création d'un câble duplicate même en finalisation
          if (cableExistsBetweenNodes(routingFromNode, node.id)) {
            alert('Un câble existe déjà entre ces deux nœuds !');
            clearRouting(); // Nettoyer le routage en cours
            return;
          }
          
          // Créer le tracé complet avec tous les points intermédiaires + point final
          const finalCoords = [...routingPointsRef.current, { lat: node.lat, lng: node.lng }];
          console.log('Final cable coordinates:', finalCoords);
          
          if (finalCoords.length >= 2) {
            addCable(routingFromNode, node.id, selectedCableType, finalCoords);
            clearRouting();
          }
          return;
        }
        
        // MODE NORMAL: Sélection et début de tracé
        if (selectedTool === 'select') {
          setSelectedNode(node.id);
          openEditPanel('node');
        } else if (selectedTool === 'addCable') {
          console.log('=== ADD CABLE TOOL CLICKED ON NODE ===');
          console.log('Current selectedNodeId:', selectedNodeId);
          console.log('Clicked node:', node.id);
          console.log('routingActive:', routingActive);
          
          // Premier clic: sélectionner noeud de départ
          if (!selectedNodeId) {
            console.log('Selecting start node:', node.id);
            setSelectedNode(node.id);
            return;
          }
          
          // Deuxième clic: démarrer ou terminer le câble
          if (selectedNodeId !== node.id) {
            console.log('Second click - start to end cable connection');
            
            // VÉRIFICATION : Empêcher la création d'un câble duplicate
            if (cableExistsBetweenNodes(selectedNodeId, node.id)) {
              alert('Un câble existe déjà entre ces deux nœuds !');
              setSelectedNode(null); // Désélectionner
              return;
            }
            
            const cableType = currentProject?.cableTypes.find(ct => ct.id === selectedCableType);
            const isUnderground = cableType?.posesPermises.includes('SOUTERRAIN') && !cableType?.posesPermises.includes('AÉRIEN');
            console.log('Cable type:', cableType?.id, 'isUnderground:', isUnderground);
            
            if (isUnderground) {
              // CÂBLE SOUTERRAIN: Démarrer le mode routage
              const fromNode = currentProject.nodes.find(n => n.id === selectedNodeId);
              if (fromNode) {
                console.log('=== STARTING UNDERGROUND CABLE ROUTING ===');
                console.log('From node:', selectedNodeId, 'To node:', node.id);
                
                setRoutingFromNode(selectedNodeId);
                setRoutingToNode(node.id);
                routingPointsRef.current = [{ lat: fromNode.lat, lng: fromNode.lng }];
                setRoutingActive(true);
                setSelectedNode(null); // Désélectionner pour éviter la confusion
                
                console.log('Routing activated, click on map to add intermediate points, then click on destination node to finish');
              }
            } else {
              // CÂBLE AÉRIEN: Connexion directe
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
          } else {
            console.log('Same node clicked - ignoring');
          }
        } else if (selectedTool === 'edit') {
          setSelectedNode(node.id);
          openEditPanel('node');
        } else if (selectedTool === 'delete') {
          if (confirm(`Supprimer le nœud "${node.name}" ?`)) {
            deleteNode(node.id);
          }
        } else if (selectedTool === 'move') {
          setSelectedNode(node.id);
        }
      });

      // Gestionnaire pour le drag & drop
      marker.on('dragend', (e) => {
        const newLatLng = e.target.getLatLng();
        moveNode(node.id, newLatLng.lat, newLatLng.lng);
      });

      markersRef.current.set(node.id, marker);
    });
  }, [currentProject?.nodes, selectedTool, selectedNodeId, selectedCableType, addCable, setSelectedNode, openEditPanel, deleteNode, showVoltages, calculationResults, selectedScenario, moveNode, routingActive, routingFromNode, routingToNode]);

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