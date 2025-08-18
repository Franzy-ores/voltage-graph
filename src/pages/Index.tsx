import { TopMenu } from "@/components/TopMenu";
import { MapView } from "@/components/MapView";
import { Toolbar } from "@/components/Toolbar";
import { ResultsPanel } from "@/components/ResultsPanel";
import { EditPanel } from "@/components/EditPanel";
import { VoltageDisplay } from "@/components/VoltageDisplay";
import { useNetworkStore } from "@/store/networkStore";

const Index = () => {
  const { 
    currentProject, 
    selectedScenario, 
    calculationResults,
    createNewProject,
    openEditPanel,
    calculateAll
  } = useNetworkStore();

  const handleNewNetwork = () => {
    createNewProject("Nouveau Réseau", "TÉTRAPHASÉ_400V");
  };

  const handleSave = () => {
    if (currentProject) {
      const dataStr = JSON.stringify(currentProject, null, 2);
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
            const project = JSON.parse(e.target?.result as string);
            // TODO: Load project into store
            console.log('Loading project:', project);
          } catch (error) {
            console.error('Error loading project:', error);
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
