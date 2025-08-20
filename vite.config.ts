import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Configuration spécifique pour Leaflet en production
  build: {
    rollupOptions: {
      external: [],
      output: {
        // Assurer que les assets Leaflet sont correctement copiés
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.includes('leaflet')) {
            return 'assets/leaflet/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  },
  // Optimisation des dépendances pour Leaflet
  optimizeDeps: {
    include: ['leaflet']
  }
}));
