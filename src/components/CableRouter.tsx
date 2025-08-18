import { useRef, useEffect } from 'react';
import L from 'leaflet';
import { useNetworkStore } from '@/store/networkStore';

interface CableRouterProps {
  map: L.Map;
  isActive: boolean;
  fromNodeId: string;
  toNodeId: string;
  onRouteComplete: (coordinates: { lat: number; lng: number }[]) => void;
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

    // Obtenir les nœuds source et destination
    const fromNode = currentProject.nodes.find(n => n.id === fromNodeId);
    const toNode = currentProject.nodes.find(n => n.id === toNodeId);
    console.log('CableRouter nodes:', { fromNode: fromNode?.name, toNode: toNode?.name });
    
    if (!fromNode || !toNode) return;

    // Obtenir le type de câble sélectionné
    const cableType = currentProject.cableTypes.find(ct => ct.id === selectedCableType);
    console.log('CableRouter cable type:', { selectedCableType, cableType });
    
    if (!cableType) return;

    // Déterminer le type de pose
    const isAerial = cableType.posesPermises.includes('AÉRIEN');
    const isUnderground = cableType.posesPermises.includes('SOUTERRAIN');
    console.log('CableRouter pose types:', { isAerial, isUnderground });

    // Si câble aérien uniquement, créer ligne droite immédiatement
    if (isAerial && !isUnderground) {
      console.log('Creating direct aerial cable connection');
      const directRoute = [
        { lat: fromNode.lat, lng: fromNode.lng },
        { lat: toNode.lat, lng: toNode.lng }
      ];
      onRouteComplete(directRoute);
      return;
    }

    // Pour câbles souterrains ou mixtes, permettre le routage manuel
    console.log('Starting underground cable routing');
    routingPointsRef.current = [{ lat: fromNode.lat, lng: fromNode.lng }];

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      // Ajouter un point de routage
      routingPointsRef.current.push({ lat: e.latlng.lat, lng: e.latlng.lng });
      
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

      // Mettre à jour la ligne temporaire
      updateTempLine();
    };

    const updateTempLine = () => {
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

    const handleDoubleClick = (e: L.LeafletMouseEvent) => {
      // Ajouter le nœud de destination et terminer
      if (toNode) {
        routingPointsRef.current.push({ lat: toNode.lat, lng: toNode.lng });
        onRouteComplete([...routingPointsRef.current]);
        clearRouting();
      }
    };

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && routingPointsRef.current.length >= 1) {
        // Ajouter le nœud de destination et terminer
        if (toNode) {
          routingPointsRef.current.push({ lat: toNode.lat, lng: toNode.lng });
          onRouteComplete([...routingPointsRef.current]);
          clearRouting();
        }
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

    // Ajouter les marqueurs de départ et d'arrivée
    const startMarker = L.marker([fromNode.lat, fromNode.lng], {
      icon: L.divIcon({
        className: 'routing-start',
        html: '<div class="w-4 h-4 bg-green-500 border border-white rounded-full"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      })
    }).addTo(map);
    
    const endMarker = L.marker([toNode.lat, toNode.lng], {
      icon: L.divIcon({
        className: 'routing-end',
        html: '<div class="w-4 h-4 bg-red-500 border border-white rounded-full"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      })
    }).addTo(map);
    
    tempMarkersRef.current.push(startMarker, endMarker);
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