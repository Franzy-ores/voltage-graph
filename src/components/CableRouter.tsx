import { useRef, useEffect } from 'react';
import L from 'leaflet';
import { useNetworkStore } from '@/store/networkStore';

interface CableRouterProps {
  map: L.Map;
  isActive: boolean;
  fromNodeId: string;
  toNodeId: string;
  onRouteComplete: (coordinates: { lat: number; lng: number }[], fromNodeId?: string, toNodeId?: string) => void;
  onCancel: () => void;
}

export const CableRouter = ({ map, isActive, fromNodeId, toNodeId, onRouteComplete, onCancel }: CableRouterProps) => {
  const { currentProject, selectedCableType } = useNetworkStore();
  const routingPointsRef = useRef<{ lat: number; lng: number }[]>([]);
  const tempMarkersRef = useRef<L.Marker[]>([]);
  const tempLineRef = useRef<L.Polyline | null>(null);

  useEffect(() => {
    console.log('CableRouter useEffect:', { isActive, hasMap: !!map, hasProject: !!currentProject, fromNodeId, toNodeId });
    
    if (!isActive || !map || !currentProject) return;

    // Obtenir le nœud source - toujours requis
    const fromNode = currentProject.nodes.find(n => n.id === fromNodeId);
    console.log('CableRouter nodes:', { fromNode: fromNode?.name, toNodeId });
    
    if (!fromNode) return;

    // Obtenir le type de câble sélectionné
    const cableType = currentProject.cableTypes.find(ct => ct.id === selectedCableType);
    console.log('CableRouter cable type:', { selectedCableType, cableType });
    
    if (!cableType) return;

    // Déterminer le type de pose
    const isAerial = cableType.posesPermises.includes('AÉRIEN');
    const isUnderground = cableType.posesPermises.includes('SOUTERRAIN');
    console.log('CableRouter pose types:', { isAerial, isUnderground });

    // Pour câbles souterrains, permettre le routage manuel
    console.log('Starting underground cable routing');
    routingPointsRef.current = [{ lat: fromNode.lat, lng: fromNode.lng }];

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      // Vérifier si on clique sur un nœud pour finaliser
      const clickedNode = currentProject.nodes.find(node => {
        const distance = map.distance([e.latlng.lat, e.latlng.lng], [node.lat, node.lng]);
        return distance < 50 && node.id !== fromNodeId; // Pas le nœud de départ
      });
      
      if (clickedNode) {
        console.log('Clicked on destination node, finishing route:', clickedNode.name);
        routingPointsRef.current.push({ lat: clickedNode.lat, lng: clickedNode.lng });
        // Passer aussi l'ID du nœud de destination
        onRouteComplete([...routingPointsRef.current], fromNodeId, clickedNode.id);
        clearRouting();
        return;
      }
      
      // Sinon, ajouter un point de routage intermédiaire
      routingPointsRef.current.push({ lat: e.latlng.lat, lng: e.latlng.lng });
      console.log('Added intermediate point:', { lat: e.latlng.lat, lng: e.latlng.lng });
      
      // Ajouter un marqueur temporaire
      const marker = L.marker([e.latlng.lat, e.latlng.lng], {
        icon: L.divIcon({
          className: 'routing-point',
          html: '<div class="w-3 h-3 bg-blue-500 border border-white rounded-full"></div>',
          iconSize: [12, 12],
          iconAnchor: [6, 6]
        })
      });
      
      try {
        marker.addTo(map);
        tempMarkersRef.current.push(marker);
      } catch (error) {
        console.warn('Error adding routing marker:', error);
      }

      // Mettre à jour la ligne temporaire
      updateTempLine();
    };

    const updateTempLine = () => {
      if (tempLineRef.current) {
        try {
          map.removeLayer(tempLineRef.current);
        } catch (error) {
          console.warn('Error removing temp line:', error);
        }
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
        );
        
        try {
          tempLineRef.current.addTo(map);
        } catch (error) {
          console.warn('Error adding temp line:', error);
        }
      }
    };

    const handleDoubleClick = (e: L.LeafletMouseEvent) => {
      // Double-clic pour terminer le routage sans nœud spécifique
      console.log('Double-click detected, ending route at current position');
      routingPointsRef.current.push({ lat: e.latlng.lat, lng: e.latlng.lng });
      onRouteComplete([...routingPointsRef.current]);
      clearRouting();
    };

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && routingPointsRef.current.length >= 1) {
        // ENTRÉE pour terminer à la position actuelle
        console.log('Enter pressed, ending route');
        onRouteComplete([...routingPointsRef.current]);
        clearRouting();
      } else if (e.key === 'Escape') {
        // Annuler le routage
        onCancel();
        clearRouting();
      }
    };

    const clearRouting = () => {
      // Nettoyer les marqueurs temporaires
      tempMarkersRef.current.forEach(marker => map.removeLayer(marker));
      tempMarkersRef.current = [];
      
      // Nettoyer la ligne temporaire
      if (tempLineRef.current) {
        map.removeLayer(tempLineRef.current);
        tempLineRef.current = null;
      }
      
      // Réinitialiser les points
      routingPointsRef.current = [];
    };

    // Ajouter seulement le marqueur de départ
    if (map && map.getContainer()) {
      const startMarker = L.marker([fromNode.lat, fromNode.lng], {
        icon: L.divIcon({
          className: 'routing-start',
          html: '<div class="w-4 h-4 bg-green-500 border border-white rounded-full"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        })
      });
      
      // Vérifier que la carte existe avant d'ajouter les marqueurs
      try {
        startMarker.addTo(map);
        tempMarkersRef.current.push(startMarker);
      } catch (error) {
        console.warn('Error adding start marker:', error);
      }
    }
    updateTempLine();

    map.on('click', handleMapClick);
    map.on('dblclick', handleDoubleClick);
    document.addEventListener('keydown', handleKeyPress);

    return () => {
      map.off('click', handleMapClick);
      map.off('dblclick', handleDoubleClick);
      document.removeEventListener('keydown', handleKeyPress);
      clearRouting();
    };
  }, [isActive, map, fromNodeId, toNodeId, onRouteComplete, onCancel, currentProject, selectedCableType]);

  return null;
};