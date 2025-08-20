import { useState, useRef, useEffect } from 'react';
import { Search, X, MapPin } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';

interface SearchResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  importance: number;
}

interface AddressSearchProps {
  onLocationSelect: (lat: number, lng: number, address: string) => void;
}

export const AddressSearch = ({ onLocationSelect }: AddressSearchProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout>();
  const searchRef = useRef<HTMLDivElement>(null);

  // Fermer les résultats si on clique ailleurs
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchAddress = async (searchQuery: string) => {
    if (!searchQuery.trim() || searchQuery.length < 3) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      // Utiliser Nominatim (gratuit) pour le géocodage
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5&countrycodes=be,fr,nl&addressdetails=1`,
        {
          headers: {
            'User-Agent': 'ElectricalNetworkApp/1.0'
          }
        }
      );
      
      if (response.ok) {
        const data: SearchResult[] = await response.json();
        setResults(data);
        setShowResults(data.length > 0);
      }
    } catch (error) {
      console.error('Erreur de recherche:', error);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleInputChange = (value: string) => {
    setQuery(value);
    
    // Débounce pour éviter trop de requêtes
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    debounceRef.current = setTimeout(() => {
      searchAddress(value);
    }, 300);
  };

  const handleResultSelect = (result: SearchResult) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    
    setQuery(result.display_name);
    setShowResults(false);
    setResults([]);
    
    onLocationSelect(lat, lng, result.display_name);
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setShowResults(false);
  };

  return (
    <div ref={searchRef} className="relative w-80">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input
          type="text"
          placeholder="Rechercher une adresse..."
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => results.length > 0 && setShowResults(true)}
          className="pl-10 pr-10 bg-background/95 backdrop-blur"
        />
        {query && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearSearch}
            className="absolute right-1 top-1/2 transform -translate-y-1/2 h-8 w-8 p-0"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Résultats de recherche */}
      {showResults && results.length > 0 && (
        <div className="absolute top-full mt-1 w-full bg-background border border-border rounded-lg shadow-lg z-[1001] max-h-60 overflow-y-auto">
          {results.map((result) => (
            <button
              key={result.place_id}
              onClick={() => handleResultSelect(result)}
              className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-start gap-2 border-b border-border/50 last:border-b-0"
            >
              <MapPin className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                  {result.display_name.split(',')[0]}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {result.display_name}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Indicateur de chargement */}
      {isSearching && (
        <div className="absolute top-full mt-1 w-full bg-background border border-border rounded-lg shadow-lg z-[1001] px-3 py-2">
          <div className="text-sm text-muted-foreground">Recherche en cours...</div>
        </div>
      )}
    </div>
  );
};