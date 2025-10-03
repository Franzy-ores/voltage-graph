import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useNetworkStore } from '@/store/networkStore';
import { CableTypeSelector } from './CableTypeSelector';
import { AddressSearch } from './AddressSearch';
import { Button } from './ui/button';
import { Globe, Map as MapIcon } from 'lucide-react';
import { getConnectedNodes } from '@/utils/networkConnectivity';
import { getNodeConnectionType } from '@/utils/nodeConnectionType';

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
    simulationResults,
    simulationEquipment,
    selectedScenario,
    deleteNode,
    deleteCable,
    showVoltages,
    moveNode,
    simulationMode,
    toggleResultsPanel,
    resultsPanelOpen,
    editTarget,
    focusMode,
    toggleFocusMode,
  } = useNetworkStore();

  // Récupérer isSimulationActive du store
  const isSimulationActive = useNetworkStore(state => state.isSimulationActive);
  
  // Déterminer quels résultats utiliser - simulation si active ET équipements actifs
  const activeEquipmentCount = (simulationEquipment.srg2Devices?.filter(s => s.enabled).length || 0) + 
                               simulationEquipment.neutralCompensators.filter(c => c.enabled).length;
  
  const useSimulation = isSimulationActive && activeEquipmentCount > 0;
  
  console.log('🐛 MapView results logic:', {
    isSimulationActive,
    activeEquipmentCount,
    useSimulation,
    resultsType: useSimulation ? 'SIMULATION' : 'CALCULATION'
  });
  
  const resultsToUse = useSimulation ? simulationResults : calculationResults;

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
      preferCanvas: true, // CRUCIAL: Force le rendu Canvas pour tous les éléments vectoriels
    });

    const initialTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18,
      minZoom: 3,
    }).addTo(map);

    tileLayerRef.current = initialTileLayer;
    mapInstanceRef.current = map;

    // Exposer l'instance globalement pour leaflet-image
    (window as any).globalMap = map;

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
        addNode(e.latlng.lat, e.latlng.lng);
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
            addNode(finalPoint.lat, finalPoint.lng);
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
            addNode(lastPoint.lat, lastPoint.lng);
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
        routingPointsRef.current.map(p => [p.lat, p.lng] as [number, number]),
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

  // Fonction pour obtenir la numérotation séquentielle des circuits
  const getCircuitNumber = (circuitId: string) => {
    if (!calculationResults[selectedScenario]?.virtualBusbar?.circuits || !currentProject) {
      return null;
    }
    
    // Trouver la source
    const sourceNode = currentProject.nodes.find(n => n.isSource);
    if (!sourceNode) return null;
    
    // Obtenir tous les câbles directement connectés à la source (circuits principaux)
    const mainCircuitCables = currentProject.cables
      .filter(cable => cable.nodeAId === sourceNode.id || cable.nodeBId === sourceNode.id)
      .sort((a, b) => a.id.localeCompare(b.id)); // Tri pour assurer la cohérence
    
    // Trouver l'index du circuit
    const circuitIndex = mainCircuitCables.findIndex(cable => cable.id === circuitId);
    return circuitIndex >= 0 ? circuitIndex + 1 : null;
  };

  // Fonction pour obtenir le circuit d'un nœud
  const getNodeCircuit = (nodeId: string) => {
    if (!calculationResults[selectedScenario]?.virtualBusbar?.circuits || !currentProject) {
      return null;
    }
    
    const node = currentProject.nodes.find(n => n.id === nodeId);
    if (!node || node.isSource) return null;
    
    // Chercher le circuit auquel appartient ce nœud
    for (const circuit of calculationResults[selectedScenario].virtualBusbar.circuits) {
      const cable = currentProject.cables.find(c => c.id === circuit.circuitId);
      if (cable) {
        // Vérifier si le nœud est directement connecté au câble principal du circuit
        if (cable.nodeAId === nodeId || cable.nodeBId === nodeId) {
          return getCircuitNumber(circuit.circuitId);
        }
        
        // Vérifier si le nœud fait partie du sous-arbre de ce circuit
        // Pour cela, on vérifie s'il existe un chemin depuis le nœud aval du câble principal
        const sourceNodeId = currentProject.nodes.find(n => n.isSource)?.id;
        const targetNodeId = cable.nodeAId === sourceNodeId ? cable.nodeBId : cable.nodeAId;
        
        // Recherche simple: voir si le nœud est connecté dans le même sous-réseau
        const visited = new Set<string>();
        const stack = [targetNodeId];
        
        while (stack.length > 0) {
          const currentId = stack.pop()!;
          if (visited.has(currentId)) continue;
          visited.add(currentId);
          
          if (currentId === nodeId) {
            return getCircuitNumber(circuit.circuitId);
          }
          
          // Ajouter les nœuds voisins (sauf la source)
          const neighbors = currentProject.cables
            .filter(c => (c.nodeAId === currentId || c.nodeBId === currentId))
            .map(c => c.nodeAId === currentId ? c.nodeBId : c.nodeAId)
            .filter(id => id !== sourceNodeId && !visited.has(id));
          
          stack.push(...neighbors);
        }
      }
    }
    
    return null;
  };

  // Clear existing markers
  markersRef.current.forEach(marker => map.removeLayer(marker));
  markersRef.current.clear();

  const connectedNodes = getConnectedNodes(currentProject.nodes, currentProject.cables);

    // Add new markers
    currentProject.nodes.forEach(node => {
      // Calculer les totaux
      const totalCharge = node.clients.reduce((sum, client) => sum + client.S_kVA, 0);
      const totalPV = node.productions.reduce((sum, prod) => sum + prod.S_kVA, 0);
      
      // Calculer la tension avec chute cumulée selon le type de connexion
      let baseVoltage = 230; // Par défaut
      
      // Trouver la tension de la source principale
      const mainSourceNode = currentProject.nodes.find(n => n.isSource);
      const sourceVoltage = mainSourceNode?.tensionCible || (currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230);
      
      // Déterminer la tension de base selon le type de connexion du nœud (pour l'affichage par défaut)
      const connectionType = getNodeConnectionType(currentProject.voltageSystem, currentProject.loadModel || 'polyphase_equilibre', node.isSource);
      switch (connectionType) {
        case 'TÉTRA_3P+N_230_400V':
          baseVoltage = 400;
          break;
        case 'MONO_230V_PN': // Monophasé en réseau 400V → tension phase-neutre 230V
          baseVoltage = 230;
          break;
        case 'MONO_230V_PP':
        case 'TRI_230V_3F':
          baseVoltage = 230;
          break;
        default:
          baseVoltage = 230;
          break;
      }
      
      let nodeVoltage = sourceVoltage; // Utiliser la tension source
      let isOutOfCompliance = false;
      let nominalDropPercent = 0; // Déclarer la variable pour la conformité (signée)
      
      if (calculationResults[selectedScenario] && !node.isSource) {
        const results = resultsToUse[selectedScenario];
        const nodeData = results?.nodeVoltageDrops?.find(n => n.nodeId === node.id);
        
        // ===== AMÉLIORATION : CONFORMITÉ MULTI-PHASE EN MODE DÉSÉQUILIBRÉ =====
        // Vérifier la conformité par phase si disponible (mode déséquilibré)
        const phaseMetrics = results?.nodeMetricsPerPhase?.find(n => n.nodeId === node.id);
        if (phaseMetrics?.nodeCompliance) {
          // Mode déséquilibré : utiliser la conformité calculée par phase
          if (phaseMetrics.nodeCompliance === 'critical') {
            isOutOfCompliance = true;
            nominalDropPercent = 15; // Valeur indicative pour affichage critique
          } else if (phaseMetrics.nodeCompliance === 'warning') {
            isOutOfCompliance = false; // Pas critique mais en warning
            nominalDropPercent = 9; // Valeur indicative pour affichage warning
          } else {
            isOutOfCompliance = false;
            nominalDropPercent = 5; // Valeur indicative pour affichage normal
          }
          
          console.log(`🚨 Node ${node.id} conformité multi-phase: ${phaseMetrics.nodeCompliance} (phases: A=${phaseMetrics.compliancePerPhase?.A}, B=${phaseMetrics.compliancePerPhase?.B}, C=${phaseMetrics.compliancePerPhase?.C})`);
        } else if (nodeData) {
          // Mode équilibré ou fallback : logique standard
          // Utiliser la chute de tension cumulée SIGNÉE (+ = chute, - = hausse) avec la tension source
          nodeVoltage = sourceVoltage - nodeData.deltaU_cum_V;
          
          // Calculer l'écart par rapport à la tension nominale de référence
          const connectionType = getNodeConnectionType(currentProject.voltageSystem, currentProject.loadModel || 'polyphase_equilibre', node.isSource);
          
          // Pour les nœuds MONO_230V_PN en système 400V, utiliser la tension la plus élevée des phases
          if (connectionType === 'MONO_230V_PN' && currentProject.voltageSystem === 'TÉTRAPHASÉ_400V') {
            if (phaseMetrics) {
              // Prendre la tension la plus élevée des trois phases
              const maxPhaseVoltage = Math.max(
                phaseMetrics.voltagesPerPhase.A,
                phaseMetrics.voltagesPerPhase.B,
                phaseMetrics.voltagesPerPhase.C
              );
              nodeVoltage = maxPhaseVoltage;
              console.log(`Node ${node.id} (MONO_230V_PN): phases [${phaseMetrics.voltagesPerPhase.A.toFixed(1)}, ${phaseMetrics.voltagesPerPhase.B.toFixed(1)}, ${phaseMetrics.voltagesPerPhase.C.toFixed(1)}], max: ${maxPhaseVoltage.toFixed(1)}V`);
            }
            // Référence 230V pour MONO_230V_PN en système 400V
            const voltageDeviation = nodeVoltage - 230;
            nominalDropPercent = (voltageDeviation / 230) * 100;
          } else {
            // Logique standard pour les autres types
            let nominalVoltage: number;
            if (connectionType === 'TÉTRA_3P+N_230_400V') {
              nominalVoltage = 400;
            } else {
              nominalVoltage = 230;
            }
            
            const voltageDeviation = nodeVoltage - nominalVoltage;
            nominalDropPercent = (voltageDeviation / nominalVoltage) * 100;
          }
          
          // Conformité basée sur la valeur absolue (±10%)
          isOutOfCompliance = Math.abs(nominalDropPercent) > 10;
        }
      }
      
      // Déterminer le type et l'icône
      let iconContent = 'N';
      let iconClass = 'bg-secondary border-secondary-foreground text-secondary-foreground';
      
      // Si le nœud n'est pas alimenté (pas connecté à une source), le mettre en gris
      if (!connectedNodes.has(node.id)) {
        iconClass = 'bg-gray-400 border-gray-500 text-white';
        iconContent = node.isSource ? 'S' : 'N';
      } else if (node.isSource) {
        iconContent = 'S';
        // Source colorée selon la tension du système
        const isHighVoltage = currentProject.voltageSystem === 'TÉTRAPHASÉ_400V';
        iconClass = isHighVoltage ? 'bg-fuchsia-500 border-fuchsia-600 text-white' : 'bg-cyan-500 border-cyan-600 text-white';
      } else {
        const hasProduction = totalPV > 0;
        const hasLoad = totalCharge > 0;
        
        if (hasProduction && hasLoad) {
          iconContent = 'M'; // Mixte
          // Déterminer la couleur selon le pourcentage de variation de tension nominal (±)
          if (Math.abs(nominalDropPercent) <= 8) {
            iconClass = 'bg-yellow-500 border-yellow-600 text-white';
          } else if (Math.abs(nominalDropPercent) <= 10) {
            iconClass = 'bg-voltage-warning border-orange-600 text-white';
          } else {
            iconClass = 'bg-voltage-critical border-red-600 text-white';
          }
        } else if (hasProduction) {
          iconContent = 'P'; // Production seule
          if (Math.abs(nominalDropPercent) <= 8) {
            iconClass = 'bg-voltage-normal border-green-600 text-white';
          } else if (Math.abs(nominalDropPercent) <= 10) {
            iconClass = 'bg-voltage-warning border-orange-600 text-white';
          } else {
            iconClass = 'bg-voltage-critical border-red-600 text-white';
          }
        } else if (hasLoad) {
          iconContent = 'C'; // Charge seule
          if (Math.abs(nominalDropPercent) <= 8) {
            iconClass = 'bg-blue-500 border-blue-600 text-white';
          } else if (Math.abs(nominalDropPercent) <= 10) {
            iconClass = 'bg-voltage-warning border-orange-600 text-white';
          } else {
            iconClass = 'bg-voltage-critical border-red-600 text-white';
          }
        }
      }

      // Obtenir le numéro de circuit
      const circuitNumber = getNodeCircuit(node.id);
      
      // Déterminer si on affiche du texte (charge/production uniquement si > 0)
      const hasDisplayableLoad = !node.isSource && totalCharge > 0;
      const hasDisplayableProduction = !node.isSource && totalPV > 0;
      const hasDisplayableText = showVoltages && (hasDisplayableLoad || hasDisplayableProduction || !node.isSource);
      
      // Taille adaptative : plus grande si du texte est affiché
      const iconSize: [number, number] = hasDisplayableText ? [70, 70] : [56, 56];
      const anchorPoint: [number, number] = hasDisplayableText ? [35, 35] : [28, 28];
      const iconSizeClass = hasDisplayableText ? 'w-[70px] h-[70px]' : 'w-14 h-14';

      const icon = L.divIcon({
        className: 'custom-node-marker',
        html: `<div class="${iconSizeClass} rounded-full border-2 flex flex-col items-center justify-center text-xs font-bold ${iconClass} p-1">
          <div class="text-base">${iconContent}</div>
          ${circuitNumber ? `<div class="text-[9px] bg-black bg-opacity-50 rounded px-1">C${circuitNumber}</div>` : ''}
          ${showVoltages ? `<div class="text-[9px] leading-tight text-center">
            ${(() => {
              // Afficher les 3 phases en mode monophasé réparti
              if (currentProject.loadModel === 'monophase_reparti') {
                const results = resultsToUse[selectedScenario];
                const phaseMetrics = results?.nodeMetricsPerPhase?.find(n => n.nodeId === node.id);
                
                const isUsingSimulation = (simulationMode && activeEquipmentCount > 0);
                
                console.log('🐛 Phase voltages for node', node.id, {
                  simulationMode,
                  activeEquipmentCount,
                  usingSimulation: isUsingSimulation,
                  hasPhaseMetrics: !!phaseMetrics,
                  voltages: phaseMetrics?.voltagesPerPhase
                });
                
                // Comparaison spéciale pour le nœud compensateur
                if (node.id === 'node-1756199772381') {
                  const calcResults = calculationResults[selectedScenario];
                  const simResults = simulationResults[selectedScenario];
                  const calcMetrics = calcResults?.nodeMetricsPerPhase?.find(n => n.nodeId === node.id);
                  const simMetrics = simResults?.nodeMetricsPerPhase?.find(n => n.nodeId === node.id);
                  
                  console.log('🔍 COMPENSATEUR COMPARISON:', {
                    nodeId: node.id,
                    calculation: calcMetrics?.voltagesPerPhase,
                    simulation: simMetrics?.voltagesPerPhase,
                    difference: {
                      A: simMetrics?.voltagesPerPhase.A - calcMetrics?.voltagesPerPhase.A,
                      B: simMetrics?.voltagesPerPhase.B - calcMetrics?.voltagesPerPhase.B,
                      C: simMetrics?.voltagesPerPhase.C - calcMetrics?.voltagesPerPhase.C
                    }
                  });
                }
                
                if (phaseMetrics) {
                  const vA = phaseMetrics.voltagesPerPhase.A.toFixed(1);
                  const vB = phaseMetrics.voltagesPerPhase.B.toFixed(1);
                  const vC = phaseMetrics.voltagesPerPhase.C.toFixed(1);
                  return `<span class="text-black">A:${vA}V</span><br><span class="text-black">B:${vB}V</span><br><span class="text-black">C:${vC}V</span>`;
                } else {
                  return `A:${nodeVoltage.toFixed(0)}V<br>B:${nodeVoltage.toFixed(0)}V<br>C:${nodeVoltage.toFixed(0)}V`;
                }
              } else {
                // Mode normal : afficher une seule tension
                let displayText = `${nodeVoltage.toFixed(0)}V`;
                if (hasDisplayableLoad) {
                  displayText += `<br>${(totalCharge * (currentProject.foisonnementCharges / 100)).toFixed(1)}kVA`;
                }
                if (hasDisplayableProduction) {
                  displayText += `<br>PV: ${(totalPV * (currentProject.foisonnementProductions / 100)).toFixed(1)}kVA`;
                }
                // Ajouter l'indicateur de conformité (± % signé)
                if (!node.isSource && nominalDropPercent !== 0) {
                  const sign = nominalDropPercent >= 0 ? '+' : '';
                  const colorClass = isOutOfCompliance ? 'text-red-500' : (Math.abs(nominalDropPercent) > 5 ? 'text-yellow-500' : 'text-green-500');
                  displayText += `<br><span class="${colorClass}">${sign}${nominalDropPercent.toFixed(1)}%</span>`;
                }
                return displayText;
              }
            })()}
          </div>` : ''}
        </div>`,
        iconSize: iconSize,
        iconAnchor: anchorPoint
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
  }, [currentProject?.nodes, selectedTool, selectedNodeId, selectedCableType, addCable, setSelectedNode, openEditPanel, deleteNode, showVoltages, resultsToUse, selectedScenario, moveNode, routingActive, routingFromNode, routingToNode]);

  // Update cables
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !currentProject) return;

    cablesRef.current.forEach(cable => map.removeLayer(cable));
    cablesRef.current.clear();

    // Calculer les nœuds alimentés (connectés à une source)
    const connectedNodes = getConnectedNodes(currentProject.nodes, currentProject.cables);

    currentProject.cables.forEach(cable => {
      let cableColor = '#000000'; // noir par défaut (non calculé)
      let cableWeight = 4; // épaisseur par défaut
      
      // Vérifier si ce câble a une amélioration (suggestion ou active)
      const hasUpgrade = simulationEquipment?.cableUpgrades?.some(upgrade => {
        console.log('Checking upgrade:', upgrade.originalCableId, '=== cable.id:', cable.id, upgrade.originalCableId === cable.id);
        return upgrade.originalCableId === cable.id;
      });
      
      if (simulationEquipment?.cableUpgrades?.length > 0 && cable.id === currentProject?.cables[0]?.id) {
        console.log('Cable upgrades available:', simulationEquipment.cableUpgrades);
        console.log('Current cable ID:', cable.id);
      }
      
      if (hasUpgrade) {
        cableColor = '#8A2BE2'; // violet pour les câbles remplacés/suggérés
        cableWeight = 8; // épaisseur doublée
      } else {
        // Vérifier si les nœuds sont connectés
        const nodeAConnected = connectedNodes.has(cable.nodeAId);
        const nodeBConnected = connectedNodes.has(cable.nodeBId);
        
        // Si les nœuds sont connectés ET qu'il y a des résultats de calcul
        if (nodeAConnected && nodeBConnected) {
          const results = resultsToUse[selectedScenario];
          console.log(`Cable ${cable.id}: results available:`, !!results, 'scenario:', selectedScenario);
          console.log(`Cable ${cable.id}: nodeVoltageDrops available:`, !!(results?.nodeVoltageDrops));
          
          if (results && results.nodeVoltageDrops) {
            const calculatedCable = results.cables.find(c => c.id === cable.id);
            console.log(`Cable ${cable.id}: calculatedCable found:`, !!calculatedCable);
            
            if (calculatedCable) {
              // Utiliser le nœud d'arrivée (nodeBId) pour déterminer la couleur
              const arrivalNodeId = calculatedCable.nodeBId;
              
              // ===== AMÉLIORATION : COULEUR CÂBLES BASÉE SUR CONFORMITÉ MULTI-PHASE =====
              // Priorité à la conformité par phase si disponible (mode déséquilibré)
              const phaseMetrics = results.nodeMetricsPerPhase?.find(n => n.nodeId === arrivalNodeId);
              if (phaseMetrics?.nodeCompliance) {
                // Mode déséquilibré : utiliser la conformité calculée par phase
                if (phaseMetrics.nodeCompliance === 'critical') {
                  cableColor = '#ef4444'; // ROUGE - critique
                } else if (phaseMetrics.nodeCompliance === 'warning') {
                  cableColor = '#f97316'; // ORANGE - warning
                } else {
                  cableColor = '#22c55e'; // VERT - normal
                }
                console.log(`🎨 Cable ${cable.id}: couleur basée sur conformité multi-phase ${phaseMetrics.nodeCompliance} -> ${cableColor}`);
              } else {
                // Mode équilibré ou fallback : logique standard basée sur chute de tension
                const nodeData = results.nodeVoltageDrops.find(n => n.nodeId === arrivalNodeId);
                console.log(`Cable ${cable.id}: nodeData for ${arrivalNodeId}:`, nodeData?.deltaU_cum_percent);
                
                if (nodeData && nodeData.deltaU_cum_percent !== undefined) {
                  const voltageDropPercent = Math.abs(nodeData.deltaU_cum_percent);
                  console.log(`Cable ${cable.id}: voltage drop ${voltageDropPercent}%`);
                  
                  if (voltageDropPercent < 8) {
                    cableColor = '#22c55e'; // VERT - dans la norme (<8%)
                  } else if (voltageDropPercent < 10) {
                    cableColor = '#f97316'; // ORANGE - warning (8% à 10%)
                  } else {
                    cableColor = '#ef4444'; // ROUGE - critique (≥10%)
                  }
                }
              }
            }
          } else {
            console.log(`Cable ${cable.id}: No results for scenario ${selectedScenario}`);
          }
        } else {
          console.log(`Cable ${cable.id}: nodes not connected - nodeA: ${nodeAConnected}, nodeB: ${nodeBConnected}`);
        }
      }
      
      const polyline = L.polyline(
        cable.coordinates.map(coord => [coord.lat, coord.lng] as [number, number]),
        { 
          color: cableColor,
          weight: cableWeight,
          opacity: 0.8
        }
      ).addTo(map);

      const nodeA = currentProject.nodes.find(n => n.id === cable.nodeAId);
      const nodeB = currentProject.nodes.find(n => n.id === cable.nodeBId);
      
      // Obtenir les résultats de calcul pour ce câble
      const cableResults = calculationResults[selectedScenario];
      const cableCalc = cableResults?.cables?.find(c => c.id === cable.id);
      
      // Trouver le type de câble
      const cableType = currentProject.cableTypes.find(ct => ct.id === cable.typeId);
      
      // Tooltip au survol avec les propriétés du câble
      let tooltipContent = `<div class="cable-tooltip">
        <div class="font-semibold">${cable.name}</div>
        <div>Type: ${cableType?.label || cable.typeId}</div>
        <div>Longueur: ${Math.round(cable.length_m || 0)}m</div>`;
      
      if (cableCalc) {
        tooltipContent += `
          <div>Courant: ${cableCalc.current_A?.toFixed(1) || '-'}A</div>
          <div>Chute: ${cableCalc.voltageDropPercent?.toFixed(2) || '-'}%</div>
          <div>Pertes: ${(cableCalc.losses_kW || 0).toFixed(3)}kW</div>`;
      }
      
      tooltipContent += `</div>`;
      
      polyline.bindTooltip(tooltipContent, {
        permanent: false,
        direction: 'top',
        className: 'cable-custom-tooltip'
      });

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
  }, [currentProject?.cables, selectedTool, setSelectedCable, openEditPanel, deleteCable, calculationResults, selectedScenario, simulationEquipment, simulationMode]);

  return (
    <div className="flex-1 relative">
      <div 
        ref={mapRef} 
        id="map-container"
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
      
      {/* Bouton toggle ResultsPanel */}
      <Button
        variant="outline"
        size="icon"
        onClick={toggleResultsPanel}
        title={resultsPanelOpen ? "Masquer les résultats" : "Afficher les résultats"}
        className="absolute top-4 right-4 z-[1000] bg-background/90 backdrop-blur-sm"
      >
        <span className="text-lg">{resultsPanelOpen ? '👁️' : '📊'}</span>
      </Button>
      
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