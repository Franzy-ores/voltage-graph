import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useNetworkStore } from '@/store/networkStore';
import { VoltageDisplay } from './VoltageDisplay';
import { CableTypeSelector } from './CableTypeSelector';
import { AddressSearch } from './AddressSearch';
import { Button } from './ui/button';
import { Globe, Map as MapIcon, Layers } from 'lucide-react';

// Configuration robuste des icônes Leaflet pour production et preview
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
  const [mapType, setMapType] = useState<'osm' | 'satellite' | 'wms'>('osm');

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

  // === Init map ===
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

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // === Switch map type (OSM, Satellite, WMS) ===
  const switchMapType = (newType: 'osm' | 'satellite' | 'wms') => {
    const map = mapInstanceRef.current;
    if (!map || !tileLayerRef.current) return;

    map.removeLayer(tileLayerRef.current);

    if (newType === 'osm') {
      tileLayerRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
        minZoom: 3,
      }).addTo(map);
    } else if (newType === 'satellite') {
      tileLayerRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          attribution: '© Esri, Maxar, Earthstar Geographics, and the GIS User Community',
          maxZoom: 18,
          minZoom: 3,
        }
      ).addTo(map);
    } else if (newType === 'wms') {
  tileLayerRef.current = L.tileLayer.wms(
    'https://geoservices.wallonie.be/arcgis/services/TOPOGRAPHIE/PICC_VDIFF/MapServer/WMSServer',
    {
      layers: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28',
      format: 'image/png',
      transparent: true,
      attribution: '© SPW - Géoservices Wallonie',
      maxZoom: 22,  // Permet des zooms très détaillés (≈1/250)
      minZoom: 3,
    }
  ).addTo(map);
}

    setMapType(newType);
  };

  // === Gestion des clics sur la carte ===
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (selectedTool === 'addNode') {
        const { lat, lng } = e.latlng;
        addNode(lat, lng, 'TÉTRA_3P+N_230_400V');
        console.log('Node added at:', lat, lng);
      }
    };

    map.on('click', handleMapClick);

    return () => {
      map.off('click', handleMapClick);
    };
  }, [selectedTool, addNode]);

  // === Affichage des nœuds et câbles ===
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !currentProject) return;

    // Nettoyer les marqueurs existants
    markersRef.current.forEach(marker => {
      map.removeLayer(marker);
    });
    markersRef.current.clear();

    // Nettoyer les câbles existants
    cablesRef.current.forEach(cable => {
      map.removeLayer(cable);
    });
    cablesRef.current.clear();

    // Ajouter les nœuds
    currentProject.nodes.forEach(node => {
      const marker = L.marker([node.lat, node.lng])
        .bindPopup(`<strong>${node.name}</strong><br/>Type: ${node.connectionType}`)
        .on('click', () => {
          if (selectedTool === 'select') {
            setSelectedNode(node.id);
            openEditPanel('node');
          }
        });
      
      marker.addTo(map);
      markersRef.current.set(node.id, marker);
    });

    // Ajouter les câbles
    currentProject.cables.forEach(cable => {
      const nodeA = currentProject.nodes.find(n => n.id === cable.nodeAId);
      const nodeB = currentProject.nodes.find(n => n.id === cable.nodeBId);
      
      if (nodeA && nodeB) {
        const polyline = L.polyline([[nodeA.lat, nodeA.lng], [nodeB.lat, nodeB.lng]], {
          color: 'blue',
          weight: 3
        })
        .bindPopup(`<strong>${cable.name}</strong><br/>Longueur: ${cable.length_m.toFixed(1)} m`)
        .on('click', () => {
          if (selectedTool === 'select') {
            setSelectedCable(cable.id);
            openEditPanel('cable');
          }
        });
        
        polyline.addTo(map);
        cablesRef.current.set(cable.id, polyline);
      }
    });

  }, [currentProject, selectedTool, setSelectedNode, setSelectedCable, openEditPanel]);

  return (
    <div className="flex-1 relative">
      <div ref={mapRef} className="w-full h-full" />

      {/* Barre de recherche d'adresse */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000]">
        <AddressSearch onLocationSelect={() => {}} />
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
        <Button
          variant={mapType === 'wms' ? 'default' : 'outline'}
          size="sm"
          onClick={() => switchMapType('wms')}
          className="flex items-center gap-2"
        >
          <Layers className="w-4 h-4" />
          WMS
        </Button>
      </div>

      <VoltageDisplay />
      <CableTypeSelector />
    </div>
  );
};
