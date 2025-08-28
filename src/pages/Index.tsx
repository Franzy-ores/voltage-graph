import { TopMenu } from "@/components/TopMenu";
import { MapView } from "@/components/MapView";
import { Toolbar } from "@/components/Toolbar";
import { ResultsPanel } from "@/components/ResultsPanel";
import { EditPanel } from "@/components/EditPanel";
import { useNetworkStore } from "@/store/networkStore";

const Index = () => {
  const { 
    currentProject, 
    selectedScenario, 
    calculationResults,
    selectedTool,
    createNewProject,
    loadProject,
    openEditPanel,
    calculateAll
  } = useNetworkStore();

  const handleNewNetwork = () => {
    createNewProject("Nouveau Réseau", "TÉTRAPHASÉ_400V");
  };

  const handleSave = () => {
    if (currentProject) {
      // Calculer et inclure les bounds géographiques avant la sauvegarde
      const projectToSave = { ...currentProject };
      if (projectToSave.nodes.length > 0) {
        // Calculer les bounds géographiques
        const lats = projectToSave.nodes.map(n => n.lat);
        const lngs = projectToSave.nodes.map(n => n.lng);
        
        const north = Math.max(...lats);
        const south = Math.min(...lats);
        const east = Math.max(...lngs);
        const west = Math.min(...lngs);
        
        const center = {
          lat: (north + south) / 2,
          lng: (east + west) / 2
        };
        
        // Calculer un zoom approprié
        const latDiff = north - south;
        const lngDiff = east - west;
        const maxDiff = Math.max(latDiff, lngDiff);
        
        let zoom = 15;
        if (maxDiff > 0.1) zoom = 10;
        else if (maxDiff > 0.05) zoom = 12;
        else if (maxDiff > 0.01) zoom = 14;
        else if (maxDiff > 0.005) zoom = 15;
        else zoom = 16;
        
        projectToSave.geographicBounds = {
          north,
          south,
          east,
          west,
          center,
          zoom
        };
      }
      
      const dataStr = JSON.stringify(projectToSave, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${currentProject.name}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            console.log('🔄 Début du chargement JSON...');
            const project = JSON.parse(e.target?.result as string);
            console.log('✅ JSON parsé:', project.name, 'nodes:', project.nodes?.length, 'cables:', project.cables?.length);
            loadProject(project);
            console.log('✅ Project loaded successfully:', project.name);
          } catch (error) {
            console.error('Error loading project:', error);
            alert('Erreur lors du chargement du projet. Vérifiez le format du fichier JSON.');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const handleSettings = () => {
    openEditPanel('project');
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <TopMenu 
        onNewNetwork={handleNewNetwork}
        onSave={handleSave}
        onLoad={handleLoad}
        onSettings={handleSettings}
      />
      
      <div className="flex-1 flex relative">
        <Toolbar />
        <MapView />
        <ResultsPanel
          results={calculationResults}
          selectedScenario={selectedScenario}
        />
      </div>
      
      <EditPanel />
    </div>
  );
};

export default Index;
