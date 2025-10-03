import { create } from 'zustand';
import { 
  NetworkState, 
  Project, 
  Node, 
  Cable, 
  ConnectionType, 
  VoltageSystem, 
  CalculationScenario, 
  CalculationResult,
  TransformerConfig,
  TransformerRating,
  VirtualBusbar,
  NeutralCompensator,
  CableUpgrade,
  SimulationEquipment
} from '@/types/network';
import { SRG2Config, DEFAULT_SRG2_400_CONFIG, DEFAULT_SRG2_230_CONFIG } from '@/types/srg2';
import { NodeWithConnectionType, getNodeConnectionType, addConnectionTypeToNodes } from '@/utils/nodeConnectionType';
import { defaultCableTypes } from '@/data/defaultCableTypes';
import { ElectricalCalculator } from '@/utils/electricalCalculations';
import { SimulationCalculator } from '@/utils/simulationCalculator';
import { toast } from 'sonner';

// Fonction pour calculer les bounds géographiques d'un projet
const calculateProjectBounds = (nodes: Node[]) => {
  if (nodes.length === 0) return undefined;

  const lats = nodes.map(n => n.lat);
  const lngs = nodes.map(n => n.lng);
  
  const north = Math.max(...lats);
  const south = Math.min(...lats);
  const east = Math.max(...lngs);
  const west = Math.min(...lngs);
  
  const center = {
    lat: (north + south) / 2,
    lng: (east + west) / 2
  };
  
  // Calculer un zoom approprié basé sur la distance
  const latDiff = north - south;
  const lngDiff = east - west;
  const maxDiff = Math.max(latDiff, lngDiff);
  
  let zoom = 15; // zoom par défaut
  if (maxDiff > 0.1) zoom = 10;
  else if (maxDiff > 0.05) zoom = 12;
  else if (maxDiff > 0.01) zoom = 14;
  else if (maxDiff > 0.005) zoom = 15;
  else zoom = 16;
  
  return {
    north,
    south,
    east,
    west,
    center,
    zoom
  };
};

interface NetworkStoreState extends NetworkState {
  selectedCableType: string;
  simulationPreview: {
    foisonnementCharges?: number;
    loadDistribution?: { A: number; B: number; C: number };
    productionDistribution?: { A: number; B: number; C: number };
    desequilibrePourcent?: number;
    isActive: boolean;
  };
  isSimulationActive: boolean;
  resultsPanelFullscreen: boolean;
}

interface NetworkActions {
  // Project actions
  createNewProject: (name: string, voltageSystem: VoltageSystem) => void;
  loadProject: (project: Project) => void;
  updateProjectConfig: (updates: Partial<Pick<Project, 'name' | 'voltageSystem' | 'cosPhi' | 'foisonnementCharges' | 'foisonnementProductions' | 'defaultChargeKVA' | 'defaultProductionKVA' | 'loadModel' | 'desequilibrePourcent' | 'forcedModeConfig' | 'manualPhaseDistribution'>>) => void;
  
  // Node actions
  addNode: (lat: number, lng: number) => void;
  updateNode: (nodeId: string, updates: Partial<Node> & { transformerConfig?: TransformerConfig }) => void;
  deleteNode: (nodeId: string) => void;
  moveNode: (nodeId: string, lat: number, lng: number) => void;
  
  // Cable actions
  addCable: (nodeAId: string, nodeBId: string, typeId: string, coordinates: { lat: number; lng: number; }[]) => void;
  updateCable: (cableId: string, updates: Partial<Cable>) => void;
  deleteCable: (cableId: string) => void;
  
  // UI actions
  setSelectedTool: (tool: NetworkState['selectedTool']) => void;
  setSelectedScenario: (scenario: CalculationScenario) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setSelectedCable: (cableId: string | null) => void;
  setSelectedCableType: (cableTypeId: string) => void;
  openEditPanel: (target: 'node' | 'cable' | 'project' | 'simulation') => void;
  closeEditPanel: () => void;
  
  // Calculations
  calculateAll: () => void;
  updateAllCalculations: () => void;
  
  // Simulation actions
  toggleSimulationMode: () => void;
  toggleSimulationActive: () => void;
  updateSimulationPreview: (preview: Partial<NetworkStoreState['simulationPreview']>) => void;
  clearSimulationPreview: () => void;
  // Méthodes SRG2
  addSRG2Device: (nodeId: string) => void;
  removeSRG2Device: (srg2Id: string) => void;
  updateSRG2Device: (srg2Id: string, updates: Partial<SRG2Config>) => void;
  // Méthodes compensateur de neutre
  addNeutralCompensator: (nodeId: string) => void;
  removeNeutralCompensator: (compensatorId: string) => void;
  updateNeutralCompensator: (compensatorId: string, updates: Partial<NeutralCompensator>) => void;
  proposeCableUpgrades: (threshold?: number) => void;
  toggleCableUpgrade: (upgradeId: string) => void;
  runSimulation: () => void;
  
  // Validation
  validateConnectionType: (connectionType: ConnectionType, voltageSystem: VoltageSystem) => boolean;
  
  // Display settings
  setShowVoltages: (show: boolean) => void;
  toggleResultsPanel: () => void;
  toggleResultsPanelFullscreen: () => void;
  toggleFocusMode: () => void;
  changeVoltageSystem: () => void;
  setFoisonnementCharges: (value: number) => void;
  setFoisonnementProductions: (value: number) => void;
  calculateWithTargetVoltage: (nodeId: string, targetVoltage: number) => void;
  updateCableTypes: () => void;
}

// Fonction utilitaire pour créer la configuration par défaut du transformateur
const createDefaultTransformerConfig = (voltageSystem: VoltageSystem): TransformerConfig => {
  const nominalVoltage = voltageSystem === "TRIPHASÉ_230V" ? 230 : 400;
  
  return {
    rating: "160kVA" as TransformerRating,
    nominalPower_kVA: 160,
    nominalVoltage_V: nominalVoltage,
    shortCircuitVoltage_percent: 4.0, // Valeur typique pour un transformateur 160kVA
    cosPhi: 0.95 // Facteur de puissance typique PV
  };
};

// Mapping robuste des types de connexion lors d'un changement de système de tension
const mapConnectionTypeForVoltageSystem = (
  oldType: ConnectionType,
  newVoltageSystem: VoltageSystem,
  isSource = false
): ConnectionType => {
  if (newVoltageSystem === 'TRIPHASÉ_230V') {
    // Passage 400V -> 230V
    switch (oldType) {
      case 'TÉTRA_3P+N_230_400V':
        return 'TRI_230V_3F';
      case 'MONO_230V_PN':
        return 'MONO_230V_PP';
      case 'MONO_230V_PP':
      case 'TRI_230V_3F':
        return oldType; // déjà compatibles
      default:
        return isSource ? 'TRI_230V_3F' : 'TRI_230V_3F';
    }
  } else {
    // Passage 230V -> 400V
    switch (oldType) {
      case 'TRI_230V_3F':
        return 'TÉTRA_3P+N_230_400V';
      case 'MONO_230V_PP':
        return 'MONO_230V_PN';
      case 'MONO_230V_PN':
      case 'TÉTRA_3P+N_230_400V':
        return oldType; // déjà compatibles
      default:
        return isSource ? 'TÉTRA_3P+N_230_400V' : 'TÉTRA_3P+N_230_400V';
    }
  }
};

// Mapping pour adapter les types de connexion selon le modèle de charge
const mapConnectionTypeForLoadModel = (
  voltageSystem: VoltageSystem,
  loadModel: 'monophase_reparti' | 'polyphase_equilibre',
  isSource = false
): ConnectionType => {
  // Les sources gardent toujours leur type par défaut selon le système de tension
  if (isSource) {
    return voltageSystem === 'TRIPHASÉ_230V' ? 'TRI_230V_3F' : 'TÉTRA_3P+N_230_400V';
  }

  if (voltageSystem === 'TRIPHASÉ_230V') {
    return loadModel === 'monophase_reparti' ? 'MONO_230V_PP' : 'TRI_230V_3F';
  } else { // 'TÉTRAPHASÉ_400V'
    return loadModel === 'monophase_reparti' ? 'MONO_230V_PN' : 'TÉTRA_3P+N_230_400V';
  }
};

const createDefaultProject = (): Project => ({
  id: `project-${Date.now()}`,
  name: "Nouveau Projet",
  voltageSystem: "TÉTRAPHASÉ_400V",
  cosPhi: 0.95,
  foisonnementCharges: 100,
  foisonnementProductions: 100,
  defaultChargeKVA: 10,
  defaultProductionKVA: 5,
  transformerConfig: createDefaultTransformerConfig("TÉTRAPHASÉ_400V"), // Configuration transformateur par défaut
  loadModel: 'polyphase_equilibre',
  desequilibrePourcent: 0,
  manualPhaseDistribution: {
    charges: { A: 33.33, B: 33.33, C: 33.34 },
    productions: { A: 33.33, B: 33.33, C: 33.34 },
    constraints: { min: -20, max: 20, total: 100 }
  },
  nodes: [
    {
      id: "source",
      name: "Source",
      lat: 46.6167,
      lng: 6.8833,
      connectionType: "TÉTRA_3P+N_230_400V",
      clients: [],
      productions: [],
      isSource: true
    }
  ],
  cables: [],
  cableTypes: defaultCableTypes
});

const createDefaultProject2 = (name: string, voltageSystem: VoltageSystem): Project => ({
  id: `project-${Date.now()}`,
  name,
  voltageSystem,
  cosPhi: 0.95,
  foisonnementCharges: 100,
  foisonnementProductions: 100,
  defaultChargeKVA: 10,
  defaultProductionKVA: 5,
  transformerConfig: createDefaultTransformerConfig(voltageSystem), // Configuration transformateur adaptée au système
  loadModel: 'polyphase_equilibre',
  desequilibrePourcent: 0,
  manualPhaseDistribution: {
    charges: { A: 33.33, B: 33.33, C: 33.34 },
    productions: { A: 33.33, B: 33.33, C: 33.34 },
    constraints: { min: -20, max: 20, total: 100 }
  },
  nodes: [],
  cables: [],
  cableTypes: [...defaultCableTypes]
});

export const useNetworkStore = create<NetworkStoreState & NetworkActions>((set, get) => ({
  // État de preview de simulation
  simulationPreview: {
    isActive: false
  },
  isSimulationActive: false,
  // State
  currentProject: createDefaultProject(),
  selectedScenario: 'MIXTE',
  calculationResults: {
    PRÉLÈVEMENT: null,
    MIXTE: null,
    PRODUCTION: null,
    FORCÉ: null
  },
  simulationResults: {
    PRÉLÈVEMENT: null,
    MIXTE: null,
    PRODUCTION: null,
    FORCÉ: null
  },
  selectedTool: 'select',
  selectedNodeId: null,
  selectedCableId: null,
  selectedCableType: 'baxb-95', // Par défaut, câble aérien
  editPanelOpen: false,
  editTarget: null,
  showVoltages: true,
  resultsPanelOpen: true,
  resultsPanelFullscreen: false,
  focusMode: false,
  simulationMode: false,
  simulationEquipment: {
    srg2Devices: [],
    neutralCompensators: [],
    cableUpgrades: []
  },

  // Actions
  createNewProject: (name, voltageSystem) => {
    const project = createDefaultProject2(name, voltageSystem);
    set({ 
      currentProject: project,
      selectedNodeId: null,
      selectedCableId: null,
      selectedTool: 'select',
      editPanelOpen: false,
      editTarget: null,
      showVoltages: true,
      simulationMode: false,
      isSimulationActive: false,
      calculationResults: {
        PRÉLÈVEMENT: null,
        MIXTE: null,
        PRODUCTION: null,
        FORCÉ: null
      },
      simulationResults: {
        PRÉLÈVEMENT: null,
        MIXTE: null,
        PRODUCTION: null,
        FORCÉ: null
      },
      simulationEquipment: {
        srg2Devices: [],
        neutralCompensators: [],
        cableUpgrades: []
      }
    });
  },

  loadProject: (project) => {
    console.log('🔄 Store.loadProject called with:', project.name);
    
    // Vérifier que le projet a la structure minimale requise
    if (!project.transformerConfig) {
      console.log('⚠️ Projet sans transformerConfig, ajout de la config par défaut');
      project.transformerConfig = createDefaultTransformerConfig(project.voltageSystem || "TÉTRAPHASÉ_400V");
    }

    // Assurer que manualPhaseDistribution existe
    if (!project.manualPhaseDistribution) {
      console.log('⚠️ Projet sans manualPhaseDistribution, ajout de la config par défaut');
      project.manualPhaseDistribution = {
        charges: { A: 33.33, B: 33.33, C: 33.34 },
        productions: { A: 33.33, B: 33.33, C: 33.34 },
        constraints: { min: -20, max: 20, total: 100 }
      };
    }

    // Calculer les bounds géographiques si pas encore définis
    if (!project.geographicBounds && project.nodes.length > 0) {
      project.geographicBounds = calculateProjectBounds(project.nodes);
    }

    // Vérifier si les types de câbles sont à jour
    if (project.cableTypes.length !== defaultCableTypes.length) {
      console.log(`Mise à jour des types de câbles: ${project.cableTypes.length} -> ${defaultCableTypes.length}`);
      project.cableTypes = [...defaultCableTypes];
      toast.info(`Types de câbles mis à jour: ${defaultCableTypes.length} types disponibles`);
    }

    console.log('🔄 Setting state with project:', project.name);
    set({ 
      currentProject: project,
      selectedNodeId: null,
      selectedCableId: null,
      selectedTool: 'select',
      editPanelOpen: false,
      editTarget: null,
      showVoltages: true,
      simulationMode: false,
      isSimulationActive: false,
      calculationResults: {
        PRÉLÈVEMENT: null,
        MIXTE: null,
        PRODUCTION: null,
        FORCÉ: null
      },
      simulationResults: {
        PRÉLÈVEMENT: null,
        MIXTE: null,
        PRODUCTION: null,
        FORCÉ: null
      },
      simulationEquipment: {
        srg2Devices: [],
        neutralCompensators: [],
        cableUpgrades: []
      }
    });
    console.log('✅ State updated successfully');
    
    // Recalculer immédiatement
    console.log('🔄 Triggering calculations...');
    get().updateAllCalculations();
    console.log('✅ Calculations triggered');
    
    // Déclencher le zoom sur le projet chargé après un court délai
    setTimeout(() => {
      console.log('🔄 Triggering zoom to project bounds');
      const event = new CustomEvent('zoomToProject', { 
        detail: project.geographicBounds 
      });
      window.dispatchEvent(event);
      console.log('✅ Zoom event dispatched');
    }, 100);
    
    console.log('✅ loadProject completed successfully');
  },

  updateProjectConfig: (updates) => {
    const { currentProject, updateAllCalculations } = get();
    if (!currentProject) return;
    
    let updatedProject = { ...currentProject, ...updates } as Project;

    // Si le système de tension change, harmoniser tout le projet
    if (updates.voltageSystem && updates.voltageSystem !== currentProject.voltageSystem) {
      const newVS: VoltageSystem = updates.voltageSystem;
      const newNominal = newVS === 'TRIPHASÉ_230V' ? 230 : 400;

      // Mettre à jour tous les nœuds avec un mapping précis (et retirer la tensionCible de la source)
      const updatedNodes = currentProject.nodes.map((n) => ({
        ...n,
        connectionType: mapConnectionTypeForVoltageSystem(n.connectionType, newVS, !!n.isSource),
        tensionCible: n.isSource ? undefined : n.tensionCible,
      }));

      // Mettre à jour la config transformateur (ou créer une valeur par défaut)
      const updatedTransformer: TransformerConfig = {
        ...(currentProject.transformerConfig || createDefaultTransformerConfig(newVS)),
        nominalVoltage_V: newNominal,
      };

      updatedProject = {
        ...updatedProject,
        voltageSystem: newVS,
        nodes: updatedNodes,
        transformerConfig: updatedTransformer,
      } as Project;
    }

    // Si le modèle de charge change, adapter tous les types de connexion des nœuds
    if (updates.loadModel && updates.loadModel !== currentProject.loadModel) {
      const newLoadModel = updates.loadModel;
      
      // Mettre à jour tous les nœuds avec le type de connexion approprié
      const updatedNodes = updatedProject.nodes.map((n) => ({
        ...n,
        connectionType: mapConnectionTypeForLoadModel(updatedProject.voltageSystem, newLoadModel, !!n.isSource)
      }));

      updatedProject = {
        ...updatedProject,
        nodes: updatedNodes,
      } as Project;
    }

    // Recalculer les bounds géographiques si les nœuds ont changé
    if (updatedProject.nodes.length > 0) {
      updatedProject.geographicBounds = calculateProjectBounds(updatedProject.nodes);
    }
    
    set({ currentProject: updatedProject });

    // Recalculs après mise à jour de la config
    updateAllCalculations();
  },

  addNode: (lat, lng) => {
    const { currentProject } = get();
    if (!currentProject) return;

    // Déduire le type de connexion automatiquement selon le modèle de charge
    const connectionType = mapConnectionTypeForLoadModel(currentProject.voltageSystem, currentProject.loadModel || 'polyphase_equilibre', currentProject.nodes.length === 0);

    const newNode: Node = {
      id: `node-${Date.now()}`,
      name: `Nœud ${currentProject.nodes.length + 1}`,
      lat,
      lng,
      connectionType,
      clients: currentProject.nodes.length === 0 ? [] : [{ 
        id: `client-${Date.now()}`, 
        label: 'Charge 1', 
        S_kVA: currentProject.defaultChargeKVA || 10 
      }],
      productions: currentProject.nodes.length === 0 ? [] : [{ 
        id: `prod-${Date.now()}`, 
        label: 'PV 1', 
        S_kVA: currentProject.defaultProductionKVA || 5
      }],
      isSource: currentProject.nodes.length === 0 // Premier nœud = source
    };

    const updatedNodes = [...currentProject.nodes, newNode];
    const updatedProject = {
      ...currentProject,
      nodes: updatedNodes,
      geographicBounds: calculateProjectBounds(updatedNodes)
    };

    set({
      currentProject: updatedProject
    });
  },

  updateNode: (nodeId, updates) => {
    set((state) => {
      if (!state.currentProject) return state;
      
      const nodeIndex = state.currentProject.nodes.findIndex(n => n.id === nodeId);
      if (nodeIndex === -1) return state;
      
      const updatedNodes = [...state.currentProject.nodes];
      const nodeUpdates = { ...updates };
      
      // Si on met à jour la configuration du transformateur d'une source
      let projectUpdates = {};
      if (updates.transformerConfig && updatedNodes[nodeIndex].isSource) {
        projectUpdates = { transformerConfig: updates.transformerConfig };
        delete nodeUpdates.transformerConfig;
      }
      
      updatedNodes[nodeIndex] = { ...updatedNodes[nodeIndex], ...nodeUpdates };
      
      return {
        ...state,
        currentProject: {
          ...state.currentProject,
          ...projectUpdates,
          nodes: updatedNodes
        }
      };
    });
    get().updateAllCalculations();
  },

  deleteNode: (nodeId) => {
    const { currentProject } = get();
    if (!currentProject) return;

    set({
      currentProject: {
        ...currentProject,
        nodes: currentProject.nodes.filter(node => node.id !== nodeId),
        cables: currentProject.cables.filter(cable => 
          cable.nodeAId !== nodeId && cable.nodeBId !== nodeId
        )
      },
      selectedNodeId: null
    });
  },

  moveNode: (nodeId, lat, lng) => {
    const { currentProject } = get();
    if (!currentProject) return;

    // Mettre à jour la position du nœud
    const updatedNodes = currentProject.nodes.map(node =>
      node.id === nodeId ? { ...node, lat, lng } : node
    );

    // Mettre à jour les câbles connectés à ce nœud
    const updatedCables = currentProject.cables.map(cable => {
      if (cable.nodeAId === nodeId || cable.nodeBId === nodeId) {
        const newCoordinates = [...cable.coordinates];
        
        if (cable.nodeAId === nodeId) {
          // Mettre à jour le premier point (départ)
          newCoordinates[0] = { lat, lng };
        }
        
        if (cable.nodeBId === nodeId) {
          // Mettre à jour le dernier point (arrivée)
          newCoordinates[newCoordinates.length - 1] = { lat, lng };
        }
        
        return {
          ...cable,
          coordinates: newCoordinates,
          length_m: ElectricalCalculator.calculateCableLength(newCoordinates)
        };
      }
      return cable;
    });

    const updatedProject = {
      ...currentProject,
      nodes: updatedNodes,
      cables: updatedCables,
      geographicBounds: calculateProjectBounds(updatedNodes)
    };

    set({
      currentProject: updatedProject
    });
  },

  addCable: (nodeAId, nodeBId, typeId, coordinates) => {
    const { currentProject } = get();
    if (!currentProject) return;

    const newCable: Cable = {
      id: `cable-${Date.now()}`,
      name: `Câble ${currentProject.cables.length + 1}`,
      typeId,
      pose: currentProject.cableTypes.find(t => t.id === typeId)?.posesPermises[0] || 'AÉRIEN',
      nodeAId,
      nodeBId,
      coordinates,
      length_m: ElectricalCalculator.calculateCableLength(coordinates)
    };

    set({
      currentProject: {
        ...currentProject,
        cables: [...currentProject.cables, newCable]
      }
    });
  },

  updateCable: (cableId, updates) => {
    const { currentProject } = get();
    if (!currentProject) return;

    set({
      currentProject: {
        ...currentProject,
        cables: currentProject.cables.map(cable => {
          if (cable.id === cableId) {
            const updatedCable = { ...cable, ...updates };
            // Recalculer la longueur si les coordonnées ont changé
            if (updates.coordinates) {
              updatedCable.length_m = ElectricalCalculator.calculateCableLength(updates.coordinates);
            }
            return updatedCable;
          }
          return cable;
        })
      }
    });
  },

  deleteCable: (cableId) => {
    const { currentProject } = get();
    if (!currentProject) return;

    set({
      currentProject: {
        ...currentProject,
        cables: currentProject.cables.filter(cable => cable.id !== cableId)
      },
      selectedCableId: null
    });
  },

  setSelectedTool: (tool) => set({ selectedTool: tool }),
  setSelectedScenario: (scenario) => {
    const { currentProject, updateAllCalculations } = get();
    
    // Définir les valeurs de curseurs selon le scénario
    let chargesValue: number;
    let productionsValue: number;
    
    switch (scenario) {
      case 'PRODUCTION':
        chargesValue = 0;
        productionsValue = 100;
        break;
      case 'MIXTE':
        chargesValue = 30;
        productionsValue = 100;
        break;
      case 'PRÉLÈVEMENT':
      default:
        chargesValue = 30;
        productionsValue = 0;
        break;
    }
    
    // Mettre à jour le scénario et les curseurs
    set({ 
      selectedScenario: scenario,
      currentProject: currentProject ? {
        ...currentProject,
        foisonnementCharges: chargesValue,
        foisonnementProductions: productionsValue
      } : currentProject
    });
    
    // Recalculer si un projet est chargé
    if (currentProject) {
      updateAllCalculations();
    }
  },
  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),
  setSelectedCable: (cableId) => set({ selectedCableId: cableId }),
  setSelectedCableType: (cableTypeId) => set({ selectedCableType: cableTypeId }),

  openEditPanel: (target) => {
    console.log('🐛 openEditPanel called with target:', target);
    // Si on ouvre le panneau de simulation, activer le mode simulation
    if (target === 'simulation') {
      console.log('🐛 Opening simulation panel');
      set({ 
        editPanelOpen: true, 
        editTarget: target,
        simulationMode: true,
        selectedTool: 'simulation'
      });
    } else {
      console.log('🐛 Opening other panel:', target);
      set({ 
        editPanelOpen: true, 
        editTarget: target 
      });
    }
    console.log('🐛 Panel state after set:', get().editTarget, get().editPanelOpen);
  },

  closeEditPanel: () => set({ 
    editPanelOpen: false, 
    editTarget: null,
    // Désactiver le mode simulation si on ferme le panneau simulation
    simulationMode: get().editTarget === 'simulation' ? false : get().simulationMode,
    selectedTool: get().editTarget === 'simulation' ? 'select' : get().selectedTool
  }),

  updateAllCalculations: () => {
    const { currentProject } = get();
    if (!currentProject) return;
    
    // Don't calculate if no cables are present
    if (!currentProject.cables || currentProject.cables.length === 0) {
      console.log('⚠️ No cables present, skipping calculations');
      return;
    }

    const calculator = new ElectricalCalculator(currentProject.cosPhi);
    
    const results = {
      PRÉLÈVEMENT: calculator.calculateScenarioWithHTConfig(
        currentProject,
        'PRÉLÈVEMENT',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.manualPhaseDistribution
      ),
      MIXTE: calculator.calculateScenarioWithHTConfig(
        currentProject,
        'MIXTE',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.manualPhaseDistribution
      ),
      PRODUCTION: calculator.calculateScenarioWithHTConfig(
        currentProject,
        'PRODUCTION',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.manualPhaseDistribution
      ),
      FORCÉ: calculator.calculateScenarioWithHTConfig(
        currentProject,
        'FORCÉ',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.manualPhaseDistribution
      )
    };

    set({ calculationResults: results });
  },

  calculateAll: () => {
    const { currentProject } = get();
    if (!currentProject) return;

    // Renuméroter les câbles depuis la source vers les nœuds les plus éloignés
    const renumberCables = () => {
      // Trouver la source
      const sourceNode = currentProject.nodes.find(node => node.isSource);
      if (!sourceNode || currentProject.cables.length === 0) return;

      // Construire un graphe des connexions
      const connections = new Map<string, string[]>();
      const cableMap = new Map<string, any>(); // Pour retrouver les câbles par connexion

      currentProject.cables.forEach(cable => {
        // Ajouter les connexions bidirectionnelles
        if (!connections.has(cable.nodeAId)) connections.set(cable.nodeAId, []);
        if (!connections.has(cable.nodeBId)) connections.set(cable.nodeBId, []);
        
        connections.get(cable.nodeAId)!.push(cable.nodeBId);
        connections.get(cable.nodeBId)!.push(cable.nodeAId);
        
        // Mapper les connexions aux câbles
        const key1 = `${cable.nodeAId}-${cable.nodeBId}`;
        const key2 = `${cable.nodeBId}-${cable.nodeAId}`;
        cableMap.set(key1, cable);
        cableMap.set(key2, cable);
      });

      // Parcours BFS depuis la source pour renuméroter
      const visited = new Set<string>();
      const cableOrder: any[] = [];
      const queue = [sourceNode.id];
      visited.add(sourceNode.id);

      while (queue.length > 0) {
        const currentNodeId = queue.shift()!;
        const neighbors = connections.get(currentNodeId) || [];

        neighbors.forEach(neighborId => {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            queue.push(neighborId);
            
            // Trouver le câble correspondant
            const cableKey = `${currentNodeId}-${neighborId}`;
            const cable = cableMap.get(cableKey);
            if (cable && !cableOrder.find(c => c.id === cable.id)) {
              cableOrder.push(cable);
            }
          }
        });
      }

      // Renuméroter les câbles trouvés
      cableOrder.forEach((cable, index) => {
        cable.name = `Câble ${index + 1}`;
      });

      console.log(`Câbles renumérotés: ${cableOrder.length} câbles depuis la source`);
    };

    // Appliquer la renumérotation
    renumberCables();

    const calculator = new ElectricalCalculator(currentProject.cosPhi);
    
    const results = {
      PRÉLÈVEMENT: calculator.calculateScenarioWithHTConfig(
        currentProject,
        'PRÉLÈVEMENT',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.manualPhaseDistribution
      ),
      MIXTE: calculator.calculateScenarioWithHTConfig(
        currentProject,
        'MIXTE',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.manualPhaseDistribution
      ),
      PRODUCTION: calculator.calculateScenarioWithHTConfig(
        currentProject,
        'PRODUCTION',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.manualPhaseDistribution
      ),
      FORCÉ: (() => {
        // Pour le mode FORCÉ, utiliser la simulation avec convergence
        if (currentProject.forcedModeConfig) {
          try {
            const simCalculator = new SimulationCalculator(currentProject.cosPhi);
            const simResult = simCalculator.calculateWithSimulation(
              currentProject,
              'FORCÉ',
              { srg2Devices: [], neutralCompensators: [], cableUpgrades: [] }
            );
            return simResult.baselineResult || simResult;
          } catch (error) {
            console.error('Erreur simulation mode FORCÉ:', error);
            // Fallback vers calcul standard
            return calculator.calculateScenarioWithHTConfig(
              currentProject,
              'FORCÉ',
              currentProject.foisonnementCharges,
              currentProject.foisonnementProductions,
              currentProject.manualPhaseDistribution
            );
          }
        } else {
          return calculator.calculateScenarioWithHTConfig(
            currentProject,
            'FORCÉ',
            currentProject.foisonnementCharges,
            currentProject.foisonnementProductions,
            currentProject.manualPhaseDistribution
          );
        }
      })()
    };

    set({ calculationResults: results });
  },

  validateConnectionType: (connectionType, voltageSystem) => {
    const validCombinations = {
      'TRIPHASÉ_230V': ['MONO_230V_PP', 'TRI_230V_3F'],
      'TÉTRAPHASÉ_400V': ['MONO_230V_PN', 'TÉTRA_3P+N_230_400V']
    };
    
    return validCombinations[voltageSystem].includes(connectionType);
  },

  setShowVoltages: (show) => set({ showVoltages: show }),

  changeVoltageSystem: () => {
    const { currentProject, updateAllCalculations, simulationEquipment } = get();
    if (!currentProject) return;

    const newVoltageSystem: VoltageSystem = 
      currentProject.voltageSystem === 'TRIPHASÉ_230V' ? 'TÉTRAPHASÉ_400V' : 'TRIPHASÉ_230V';
    
    const newNominal = newVoltageSystem === 'TRIPHASÉ_230V' ? 230 : 400;
    const is400V = newVoltageSystem === 'TÉTRAPHASÉ_400V';

    const updatedNodes = currentProject.nodes.map(node => ({
      ...node,
      connectionType: mapConnectionTypeForVoltageSystem(node.connectionType, newVoltageSystem, !!node.isSource),
      tensionCible: node.isSource ? undefined : node.tensionCible,
    }));

    const updatedTransformer: TransformerConfig = {
      ...(currentProject.transformerConfig || createDefaultTransformerConfig(newVoltageSystem)),
      nominalVoltage_V: newNominal,
    };

    // Adapter les SRG2 selon le nouveau système de tension
    const updatedSRG2Devices = (simulationEquipment.srg2Devices || []).map(srg2 => {
      const defaultConfig = is400V ? DEFAULT_SRG2_400_CONFIG : DEFAULT_SRG2_230_CONFIG;
      return {
        ...srg2,
        type: is400V ? 'SRG2-400' as const : 'SRG2-230' as const,
        seuilLO2_V: defaultConfig.seuilLO2_V!,
        seuilLO1_V: defaultConfig.seuilLO1_V!,
        seuilBO1_V: defaultConfig.seuilBO1_V!,
        seuilBO2_V: defaultConfig.seuilBO2_V!,
        coefficientLO2: defaultConfig.coefficientLO2!,
        coefficientLO1: defaultConfig.coefficientLO1!,
        coefficientBO1: defaultConfig.coefficientBO1!,
        coefficientBO2: defaultConfig.coefficientBO2!,
      };
    });

    // Désactiver les EQUI8 en 230V (pas de neutre en triphasé phase-phase)
    const updatedNeutralCompensators = simulationEquipment.neutralCompensators.map(comp => ({
      ...comp,
      enabled: is400V ? comp.enabled : false
    }));

    const updatedProject = {
      ...currentProject,
      voltageSystem: newVoltageSystem,
      nodes: updatedNodes,
      transformerConfig: updatedTransformer,
    };

    set({ 
      currentProject: updatedProject,
      simulationEquipment: {
        ...simulationEquipment,
        srg2Devices: updatedSRG2Devices,
        neutralCompensators: updatedNeutralCompensators
      }
    });

    // Recalcul automatique
    updateAllCalculations();
    
    // Relancer la simulation si des équipements sont actifs
    const hasActiveEquipment = updatedSRG2Devices.some(s => s.enabled) || 
                               updatedNeutralCompensators.some(c => c.enabled);
    if (hasActiveEquipment) {
      get().runSimulation();
    }
    
    // Toast informatif
    const srg2Count = updatedSRG2Devices.length;
    const equi8Count = updatedNeutralCompensators.length;
    
    if (srg2Count > 0 || equi8Count > 0) {
      const messages: string[] = [];
      if (srg2Count > 0) {
        messages.push(`${srg2Count} SRG2 adapté(s) en ${is400V ? 'SRG2-400' : 'SRG2-230'}`);
      }
      if (equi8Count > 0 && !is400V) {
        messages.push(`${equi8Count} EQUI8 désactivé(s) (pas de neutre en 230V)`);
      }
      toast.info(messages.join(' | '));
    }
  },

  setFoisonnementCharges: (value: number) => {
    const { currentProject, updateAllCalculations } = get();
    if (!currentProject) return;

    set({
      currentProject: {
        ...currentProject,
        foisonnementCharges: Math.max(0, Math.min(100, value))
      }
    });
    updateAllCalculations();
  },

  setFoisonnementProductions: (value: number) => {
    const { currentProject, updateAllCalculations } = get();
    if (!currentProject) return;

    set({
      currentProject: {
        ...currentProject,
        foisonnementProductions: Math.max(0, Math.min(100, value))
      }
    });
    updateAllCalculations();
  },

  calculateWithTargetVoltage: (nodeId: string, targetVoltage: number) => {
    const { currentProject, selectedScenario } = get();
    if (!currentProject) return;

    const calculator = new ElectricalCalculator(currentProject.cosPhi);
    let bestFoisonnement = 100;
    let bestVoltage = 0;
    let minDiff = Infinity;

    // Dichotomie pour trouver le foisonnement optimal
    let low = 0;
    let high = 100;
    
    for (let iteration = 0; iteration < 20; iteration++) {
      const testFoisonnement = (low + high) / 2;
      
      // Créer un projet temporaire avec ce foisonnement
      const tempProject = {
        ...currentProject,
        foisonnementCharges: testFoisonnement,
        foisonnementProductions: 0 // Ignorer les productions pour tension cible
      };

      const result = calculator.calculateScenarioWithHTConfig(
        tempProject,
        selectedScenario,
        testFoisonnement,
        0, // Ignorer les productions pour tension cible
        tempProject.manualPhaseDistribution
      );

      const nodeData = result.nodeVoltageDrops?.find(n => n.nodeId === nodeId);
      if (!nodeData) break;

      // Calculer la tension du nœud
      let baseVoltage = 230;
      const node = tempProject.nodes.find(n => n.id === nodeId);
      if (node?.connectionType === 'TÉTRA_3P+N_230_400V') {
        baseVoltage = 400;
      }
      
      const actualVoltage = baseVoltage - nodeData.deltaU_cum_V;
      const diff = Math.abs(actualVoltage - targetVoltage);
      
      if (diff < minDiff) {
        minDiff = diff;
        bestFoisonnement = testFoisonnement;
        bestVoltage = actualVoltage;
      }

      if (actualVoltage < targetVoltage) {
        // Tension trop basse → réduire le foisonnement → chercher dans la partie basse
        high = testFoisonnement;
      } else {
        // Tension trop haute → augmenter le foisonnement → chercher dans la partie haute
        low = testFoisonnement;
      }

      if (high - low < 0.1) break;
    }

    // Appliquer le meilleur foisonnement trouvé
    set({
      currentProject: {
        ...currentProject,
        foisonnementCharges: Math.round(bestFoisonnement * 10) / 10,
        foisonnementProductions: 0
      }
    });

    // Recalculer
    get().calculateAll();
    
    toast.success(`Foisonnement ajusté automatiquement à ${Math.round(bestFoisonnement * 10) / 10}% pour atteindre la tension cible`);
  },

  updateCableTypes: () => {
    const { currentProject } = get();
    if (!currentProject) return;
    
    set({
      currentProject: {
        ...currentProject,
        cableTypes: [...defaultCableTypes]
      }
    });
    
    console.log('Cable types updated to:', defaultCableTypes.length, 'types');
    toast.success('Types de câbles mis à jour avec succès');
  },

  // Actions de simulation
  toggleSimulationMode: () => {
    const { simulationMode, simulationEquipment } = get();
    const newSimulationMode = !simulationMode;
    
    set({ 
      simulationMode: newSimulationMode,
      selectedTool: newSimulationMode ? 'simulation' : 'select',
      // Réinitialiser les résultats de simulation quand on quitte le mode simulation
      simulationResults: newSimulationMode ? get().simulationResults : {
        PRÉLÈVEMENT: null,
        MIXTE: null,
        PRODUCTION: null,
        FORCÉ: null
      },
      // Désactiver tous les équipements de simulation quand on quitte le mode simulation
      simulationEquipment: newSimulationMode ? simulationEquipment : {
        srg2Devices: simulationEquipment.srg2Devices?.map(s => ({ ...s, enabled: false })) || [],
        neutralCompensators: simulationEquipment.neutralCompensators.map(c => ({ ...c, enabled: false })),
        cableUpgrades: simulationEquipment.cableUpgrades
      }
    });
  },

  toggleSimulationActive: () => {
    const { isSimulationActive, simulationEquipment } = get();
    const newActiveState = !isSimulationActive;
    
    // Désactiver/activer tous les équipements SRG2 et EQUI8
    set({ 
      isSimulationActive: newActiveState,
      simulationEquipment: {
        ...simulationEquipment,
        srg2Devices: simulationEquipment.srg2Devices?.map(s => ({ ...s, enabled: newActiveState })) || [],
        neutralCompensators: simulationEquipment.neutralCompensators.map(c => ({ ...c, enabled: newActiveState }))
      }
    });
    
    // Recalculer après changement
    if (newActiveState) {
      get().runSimulation();
    }
  },

  // Méthodes SRG2
  addSRG2Device: (nodeId: string) => {
    const state = get();
    if (!state.currentProject) return;
    
    // Déterminer le type de SRG2 selon le système de tension
    const is400V = state.currentProject.voltageSystem === 'TÉTRAPHASÉ_400V';
    const defaultConfig = is400V ? DEFAULT_SRG2_400_CONFIG : DEFAULT_SRG2_230_CONFIG;
    
    const newSRG2: SRG2Config = {
      id: `srg2-${Date.now()}`,
      nodeId,
      name: `SRG2-${state.simulationEquipment.srg2Devices.length + 1}`,
      enabled: true,
      ...defaultConfig
    } as SRG2Config;

    set({
      simulationEquipment: {
        ...state.simulationEquipment,
        srg2Devices: [...(state.simulationEquipment.srg2Devices || []), newSRG2]
      }
    });
    
    toast.success(`SRG2 ${newSRG2.name} ajouté`);
    
    // Recalculer automatiquement la simulation
    get().runSimulation();
  },

  removeSRG2Device: (srg2Id: string) => {
    const { simulationEquipment } = get();
    const srg2 = simulationEquipment.srg2Devices?.find(s => s.id === srg2Id);
    
    set({
      simulationEquipment: {
        ...simulationEquipment,
        srg2Devices: (simulationEquipment.srg2Devices || []).filter(s => s.id !== srg2Id)
      }
    });
    
    toast.success(`SRG2 ${srg2?.name} supprimé`);
    get().runSimulation();
  },

  updateSRG2Device: (srg2Id: string, updates: Partial<SRG2Config>) => {
    const { simulationEquipment, simulationMode } = get();
    
    set({
      simulationEquipment: {
        ...simulationEquipment,
        srg2Devices: (simulationEquipment.srg2Devices || []).map(s => 
          s.id === srg2Id ? { ...s, ...updates } : s
        )
      }
    });

    // Recalculer si modification pertinente
    if (typeof updates.enabled !== 'undefined' || updates.tensionConsigne_V || updates.puissanceMaxInjection_kVA) {
      if (updates.enabled === true && !simulationMode) {
        set({ simulationMode: true, selectedTool: 'simulation' });
      }
      get().runSimulation();
    } else if (simulationMode) {
      get().runSimulation();
    }
  },
  
  addNeutralCompensator: (nodeId: string) => {
    const { simulationEquipment, currentProject } = get();
    if (!currentProject) return;
    
    // Vérifier qu'il n'y a pas déjà un compensateur sur ce nœud
    const existingCompensator = simulationEquipment.neutralCompensators.find(c => c.nodeId === nodeId);
    if (existingCompensator) {
      toast.error('Un compensateur de neutre existe déjà sur ce nœud');
      return;
    }

    const newCompensator: NeutralCompensator = {
      id: `compensator-${nodeId}-${Date.now()}`,
      nodeId,
      maxPower_kVA: 30,
      tolerance_A: 5,
      enabled: true,
      Zph_Ohm: 0.5,  // Impédance câble phase (modèle EQUI8)
      Zn_Ohm: 0.2    // Impédance câble neutre (modèle EQUI8)
    };

    set({
      simulationEquipment: {
        ...simulationEquipment,
        neutralCompensators: [...simulationEquipment.neutralCompensators, newCompensator]
      }
    });
    
    toast.success('Compensateur de neutre ajouté');
    
    // Recalculer automatiquement la simulation
    get().runSimulation();
  },

  removeNeutralCompensator: (compensatorId: string) => {
    const { simulationEquipment } = get();
    set({
      simulationEquipment: {
        ...simulationEquipment,
        neutralCompensators: simulationEquipment.neutralCompensators.filter(c => c.id !== compensatorId)
      }
    });
    toast.success('Compensateur de neutre supprimé');
  },

  updateNeutralCompensator: (compensatorId: string, updates: Partial<NeutralCompensator>) => {
    const { simulationEquipment, simulationMode } = get();
    set({
      simulationEquipment: {
        ...simulationEquipment,
        neutralCompensators: simulationEquipment.neutralCompensators.map(c => 
          c.id === compensatorId ? { ...c, ...updates } : c
        )
      }
    });

    // Déclencher le calcul de simulation lors de la (ré)activation ou de toute mise à jour pertinente
    if (typeof updates.enabled !== 'undefined') {
      if (updates.enabled === true && !simulationMode) {
        set({ simulationMode: true, selectedTool: 'simulation' });
      }
      get().runSimulation();
    } else if (simulationMode) {
      // Si on est déjà en mode simulation, recalculer sur tout autre paramètre
      get().runSimulation();
    }
  },

  proposeCableUpgrades: (threshold?: number) => {
    const { currentProject, calculationResults, selectedScenario, simulationEquipment } = get();
    if (!currentProject || !calculationResults[selectedScenario]) return;

    const result = calculationResults[selectedScenario]!;
    
    // Utiliser le SimulationCalculator pour proposer des améliorations basées sur la chute de tension
    const calculator = new SimulationCalculator(currentProject.cosPhi);
    
    // Optimisation par circuit en un seul passage avec seuil paramétrable (par défaut 8%)
    const upgrades = calculator.proposeFullCircuitReinforcement(
      currentProject.cables,
      defaultCableTypes,
      threshold ?? 8.0 // Seuil paramétrable pour la chute de tension
    );

    set({
      simulationEquipment: {
        ...simulationEquipment,
        cableUpgrades: upgrades
      }
    });
    
    toast.success(`${upgrades.length} améliorations proposées (seuil: ${threshold ?? 8}%)`);
  },

  toggleCableUpgrade: (upgradeId: string) => {
    const { simulationEquipment } = get();
    // Pour la version simplifiée, nous considérons que les upgrades sont des objets avec enabled
    // Dans une version complète, il faudrait gérer l'état enabled des upgrades
    toast.info('Fonctionnalité en cours de développement');
  },

  runSimulation: () => {
    const { currentProject, selectedScenario, simulationEquipment } = get();
    if (!currentProject) return;

    try {
      const calculator = new SimulationCalculator(currentProject.cosPhi);
      
      // Calculer pour chaque scénario avec équipements de simulation
      const newSimulationResults: { [key in CalculationScenario]: any } = {
        PRÉLÈVEMENT: null,
        MIXTE: null,
        PRODUCTION: null,
        FORCÉ: null
      };
      
      const scenarios: CalculationScenario[] = ['PRÉLÈVEMENT', 'MIXTE', 'PRODUCTION', 'FORCÉ'];
      
      for (const scenario of scenarios) {
        try {
          const result = calculator.calculateWithSimulation(
            currentProject,
            scenario,
            simulationEquipment
          );
          newSimulationResults[scenario] = result;
        } catch (error) {
          console.error(`Erreur calcul simulation ${scenario}:`, error);
        }
      }
      
      // Mettre à jour l'état avec les résultats de simulation
      set({ simulationResults: newSimulationResults });
      
      const activeEquipmentCount = (simulationEquipment.srg2Devices?.filter(s => s.enabled).length || 0) + 
                                   simulationEquipment.neutralCompensators.filter(c => c.enabled).length;
      
      toast.success(`Simulation recalculée avec ${activeEquipmentCount} équipement(s) actif(s)`);
    } catch (error) {
      console.error('Erreur lors de la simulation:', error);
      toast.error('Erreur lors du calcul de simulation');
    }
  },

  // Actions de preview de simulation
  updateSimulationPreview: (preview) => {
    set(state => ({
      simulationPreview: {
        ...state.simulationPreview,
        ...preview,
        isActive: true
      }
    }));
  },

  clearSimulationPreview: () => {
    set({
      simulationPreview: {
        isActive: false
      }
    });
  },

  toggleResultsPanel: () => set(state => ({ resultsPanelOpen: !state.resultsPanelOpen })),
  toggleResultsPanelFullscreen: () => {
    const currentState = get().resultsPanelFullscreen;
    set(state => ({ resultsPanelFullscreen: !state.resultsPanelFullscreen }));
    
    // Si on passe de plein écran (true) à normal (false), recentrer la carte
    if (currentState === true) {
      // Dispatch l'événement zoomToProject avec un léger délai pour laisser le DOM se mettre à jour
      setTimeout(() => {
        const project = get().currentProject;
        if (project?.geographicBounds) {
          window.dispatchEvent(new CustomEvent('zoomToProject', { 
            detail: project.geographicBounds 
          }));
        }
      }, 100);
    }
  },
  toggleFocusMode: () => set(state => ({ 
    focusMode: !state.focusMode,
    resultsPanelOpen: !state.focusMode ? false : state.resultsPanelOpen
  })),
}));