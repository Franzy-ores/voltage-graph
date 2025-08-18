import { useRef, useEffect } from 'react';
import L from 'leaflet';

interface CableRouterProps {
  map: L.Map;
  isActive: boolean;
  onRouteComplete: (coordinates: { lat: number; lng: number }[]) => void;
  onCancel: () => void;
}

export const CableRouter = ({ map, isActive, onRouteComplete, onCancel }: CableRouterProps) => {
  const routingPointsRef = useRef<{ lat: number; lng: number }[]>([]);
  const tempMarkersRef = useRef<L.Marker[]>([]);
  const tempLineRef = useRef<L.Polyline | null>(null);

  useEffect(() => {
    if (!isActive || !map) return;

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
      if (routingPointsRef.current.length > 1) {
        if (tempLineRef.current) {
          map.removeLayer(tempLineRef.current);
        }
        
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

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && routingPointsRef.current.length >= 2) {
        // Terminer le routage
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

    map.on('click', handleMapClick);
    document.addEventListener('keydown', handleKeyPress);

    return () => {
      map.off('click', handleMapClick);
      document.removeEventListener('keydown', handleKeyPress);
      clearRouting();
    };
  }, [isActive, map, onRouteComplete, onCancel]);

  return null;
};