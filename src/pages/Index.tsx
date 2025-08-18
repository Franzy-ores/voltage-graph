import { useNetworkState } from "@/hooks/useNetworkState";
import { TopMenu } from "@/components/TopMenu";
import { NetworkCanvas } from "@/components/NetworkCanvas";
import { ResultsPanel } from "@/components/ResultsPanel";
import { ScenarioSelector } from "@/components/ScenarioSelector";
import { toast } from "sonner";

const Index = () => {
  const {
    state,
    addNode,
    addCable,
    deleteNode,
    deleteCable,
    setSelectedTool,
    setSelectedScenario,
    calculateAll,
    newNetwork
  } = useNetworkState();

  const handleNewNetwork = () => {
    newNetwork();
    toast.success("Nouveau réseau créé");
  };

  const handleSave = () => {
    // TODO: Implement save functionality
    toast.info("Fonctionnalité de sauvegarde à implémenter");
  };

  const handleLoad = () => {
    // TODO: Implement load functionality
    toast.info("Fonctionnalité de chargement à implémenter");
  };

  const handleSettings = () => {
    // TODO: Implement settings dialog
    toast.info("Paramètres généraux à implémenter");
  };

  const handleCalculate = () => {
    calculateAll();
    toast.success("Calculs effectués pour tous les scénarios");
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
        <div className="flex-1 flex flex-col">
          <NetworkCanvas
            nodes={state.nodes}
            cables={state.cables}
            selectedTool={state.selectedTool}
            onAddNode={addNode}
            onAddCable={addCable}
            onDeleteNode={deleteNode}
            onDeleteCable={deleteCable}
            onToolChange={setSelectedTool}
          />
          
          <ScenarioSelector
            selectedScenario={state.selectedScenario}
            onScenarioChange={setSelectedScenario}
            onCalculate={handleCalculate}
          />
        </div>
        
        <ResultsPanel
          results={state.calculationResults}
          selectedScenario={state.selectedScenario}
        />
      </div>
    </div>
  );
};

export default Index;
