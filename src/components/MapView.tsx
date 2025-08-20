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
          layers: 'ADRESSES,VOIRIE_AXE,HYDROG_AXE,HYDROG_BORD,CONSTR_BATIBORD,CONSTR_BATIEMPRISE,VOIRIE_LIGNE,FERROV_LIGNE,EQUIPE_AXE,TOPONYMIE,SYMBOLOGIE',
          format: 'image/png',
          transparent: true,
          attribution: '© SPW - Géoservices Wallonie',
          maxZoom: 22,
          minZoom: 3,
        }
      ).addTo(map);
    }

    setMapType(newType);
  };

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
