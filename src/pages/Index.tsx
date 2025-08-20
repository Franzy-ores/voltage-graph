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
    createNewProject,
    openEditPanel 
  } = useNetworkStore();

  const handleNewNetwork = () => {
    createNewProject("Nouveau Réseau", "TÉTRAPHASÉ_400V");
  };

  const handleSave = () => {
    // TODO: Implement save functionality
    console.log("Save clicked");
  };

  const handleLoad = () => {
    // TODO: Implement load functionality  
    console.log("Load clicked");
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
      
      <div className="flex-1 flex">
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
