import { TopMenu } from "@/components/TopMenu";
import { MapView } from "@/components/MapView";
import { Toolbar } from "@/components/Toolbar";
import { ResultsPanel } from "@/components/ResultsPanel";
import { EditPanel } from "@/components/EditPanel";
import { useNetworkStore } from "@/store/networkStore";

const Index = () => {
  const { currentProject } = useNetworkStore();

  return (
    <div className="h-screen flex flex-col bg-background">
      <TopMenu />
      
      <div className="flex-1 flex">
        <Toolbar />
        <MapView />
        <ResultsPanel />
      </div>
      
      <EditPanel />
    </div>
  );
};

export default Index;
