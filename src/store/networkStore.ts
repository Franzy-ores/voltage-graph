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
  VoltageRegulator,
  NeutralCompensator,
  CableUpgrade,
  RegulatorType,
  SimulationEquipment
} from '@/types/network';
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
}

interface NetworkActions {
  // Project actions
  createNewProject: (name: string, voltageSystem: VoltageSystem) => void;
  loadProject: (project: Project) => void;
  updateProjectConfig: (updates: Partial<Pick<Project, 'name' | 'voltageSystem' | 'cosPhi' | 'foisonnementCharges' | 'foisonnementProductions' | 'defaultChargeKVA' | 'defaultProductionKVA' | 'loadModel' | 'desequilibrePourcent'>>) => void;
  
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
  addVoltageRegulator: (nodeId: string) => void;
  removeVoltageRegulator: (regulatorId: string) => void;
  updateVoltageRegulator: (regulatorId: string, updates: Partial<VoltageRegulator>) => void;
  addNeutralCompensator: (nodeId: string) => void;
  removeNeutralCompensator: (compensatorId: string) => void;
  updateNeutralCompensator: (compensatorId: string, updates: Partial<NeutralCompensator>) => void;
  proposeCableUpgrades: () => void;
  toggleCableUpgrade: (upgradeId: string) => void;
  runSimulation: () => void;
  
  // Validation
  validateConnectionType: (connectionType: ConnectionType, voltageSystem: VoltageSystem) => boolean;
  
  // Display settings
  setShowVoltages: (show: boolean) => void;
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
  nodes: [
    {
      id: "source",
      name: "Source", 
      lat: 46.6167,
      lng: 6.8833,
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
  nodes: [],
  cables: [],
  cableTypes: [...defaultCableTypes]
});

export const useNetworkStore = create<NetworkStoreState & NetworkActions>((set, get) => ({
  // State
  currentProject: createDefaultProject(),
  selectedScenario: 'MIXTE',
  calculationResults: {
    PRÉLÈVEMENT: null,
    MIXTE: null,
    PRODUCTION: null
  },
  simulationResults: {
    PRÉLÈVEMENT: null,
    MIXTE: null,
    PRODUCTION: null
  },
  selectedTool: 'select',
  selectedNodeId: null,
  selectedCableId: null,
  selectedCableType: 'baxb-95', // Par défaut, câble aérien
  editPanelOpen: false,
  editTarget: null,
  showVoltages: false,
  simulationMode: false,
  simulationEquipment: {
    regulators: [],
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
      editPanelOpen: false,
      calculationResults: {
        PRÉLÈVEMENT: null,
        MIXTE: null,
        PRODUCTION: null
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
      selectedTool: 'select', // Forcer le retour à l'outil de sélection
      editPanelOpen: false,
      editTarget: null
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
      const updatedNodes = currentProject.nodes.map((n) => {
        const currentType = getNodeConnectionType(currentProject.voltageSystem, currentProject.loadModel || 'polyphase_equilibre', !!n.isSource);
        return {
          ...n,
          connectionType: mapConnectionTypeForVoltageSystem(currentType, newVS, !!n.isSource),
          tensionCible: n.isSource ? undefined : n.tensionCible,
        };
      });

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

    const newNode: Node = {
      id: `node-${Date.now()}`,
      name: `Nœud ${currentProject.nodes.length + 1}`,
      lat,
      lng,
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

    const calculator = new ElectricalCalculator(currentProject.cosPhi);
    
    const results = {
      PRÉLÈVEMENT: calculator.calculateScenario(
        currentProject.nodes,
        currentProject.cables,
        currentProject.cableTypes,
        'PRÉLÈVEMENT',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.transformerConfig,
        currentProject.loadModel ?? 'polyphase_equilibre',
        currentProject.desequilibrePourcent ?? 0
      ),
      MIXTE: calculator.calculateScenario(
        currentProject.nodes,
        currentProject.cables,
        currentProject.cableTypes,
        'MIXTE',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.transformerConfig,
        currentProject.loadModel ?? 'polyphase_equilibre',
        currentProject.desequilibrePourcent ?? 0
      ),
      PRODUCTION: calculator.calculateScenario(
        currentProject.nodes,
        currentProject.cables,
        currentProject.cableTypes,
        'PRODUCTION',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.transformerConfig,
        currentProject.loadModel ?? 'polyphase_equilibre',
        currentProject.desequilibrePourcent ?? 0
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
      PRÉLÈVEMENT: calculator.calculateScenario(
        currentProject.nodes, 
        currentProject.cables, 
        currentProject.cableTypes, 
        'PRÉLÈVEMENT',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.transformerConfig,
        currentProject.loadModel ?? 'polyphase_equilibre',
        currentProject.desequilibrePourcent ?? 0
      ),
      MIXTE: calculator.calculateScenario(
        currentProject.nodes, 
        currentProject.cables, 
        currentProject.cableTypes, 
        'MIXTE',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.transformerConfig,
        currentProject.loadModel ?? 'polyphase_equilibre',
        currentProject.desequilibrePourcent ?? 0
      ),
      PRODUCTION: calculator.calculateScenario(
        currentProject.nodes, 
        currentProject.cables, 
        currentProject.cableTypes, 
        'PRODUCTION',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.transformerConfig,
        currentProject.loadModel ?? 'polyphase_equilibre',
        currentProject.desequilibrePourcent ?? 0
      )
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
    const { currentProject, updateAllCalculations } = get();
    if (!currentProject) return;

    const newVoltageSystem: VoltageSystem = 
      currentProject.voltageSystem === 'TRIPHASÉ_230V' ? 'TÉTRAPHASÉ_400V' : 'TRIPHASÉ_230V';
    
    const newNominal = newVoltageSystem === 'TRIPHASÉ_230V' ? 230 : 400;

    const updatedNodes = currentProject.nodes.map(node => {
      const currentType = getNodeConnectionType(currentProject.voltageSystem, currentProject.loadModel || 'polyphase_equilibre', !!node.isSource);
      return {
        ...node,
        connectionType: mapConnectionTypeForVoltageSystem(currentType, newVoltageSystem, !!node.isSource),
        tensionCible: node.isSource ? undefined : node.tensionCible,
      };
    });

    const updatedTransformer: TransformerConfig = {
      ...(currentProject.transformerConfig || createDefaultTransformerConfig(newVoltageSystem)),
      nominalVoltage_V: newNominal,
    };

    const updatedProject = {
      ...currentProject,
      voltageSystem: newVoltageSystem,
      nodes: updatedNodes,
      transformerConfig: updatedTransformer,
    };

    set({ currentProject: updatedProject });

    // Recalcul automatique
    updateAllCalculations();
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

      const result = calculator.calculateScenario(
        tempProject.nodes,
        tempProject.cables,
        tempProject.cableTypes,
        selectedScenario,
        testFoisonnement,
        0
      );

      const nodeData = result.nodeVoltageDrops?.find(n => n.nodeId === nodeId);
      if (!nodeData) break;

      // Calculer la tension du nœud
      let baseVoltage = 230;
      const node = tempProject.nodes.find(n => n.id === nodeId);
      if (node) {
        const connectionType = getNodeConnectionType(tempProject.voltageSystem, tempProject.loadModel || 'polyphase_equilibre', !!node.isSource);
        if (connectionType === 'TÉTRA_3P+N_230_400V') {
          baseVoltage = 400;
        }
      }
      
      const actualVoltage = baseVoltage - nodeData.deltaU_cum_V;
      const diff = Math.abs(actualVoltage - targetVoltage);
      
      if (diff < minDiff) {
        minDiff = diff;
        bestFoisonnement = testFoisonnement;
        bestVoltage = actualVoltage;
      }

      if (actualVoltage < targetVoltage) {
        high = testFoisonnement - 0.1;
      } else {
        low = testFoisonnement + 0.1;
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
        PRODUCTION: null
      },
      // Désactiver tous les équipements de simulation quand on quitte le mode simulation
      simulationEquipment: newSimulationMode ? simulationEquipment : {
        regulators: simulationEquipment.regulators.map(r => ({ ...r, enabled: false })),
        neutralCompensators: simulationEquipment.neutralCompensators.map(c => ({ ...c, enabled: false })),
        cableUpgrades: simulationEquipment.cableUpgrades
      }
    });
  },

  addVoltageRegulator: (nodeId: string) => {
    const { simulationEquipment, currentProject } = get();
    if (!currentProject) return;
    
    // Vérifier qu'il n'y a pas déjà un régulateur sur ce nœud
    const existingRegulator = simulationEquipment.regulators.find(r => r.nodeId === nodeId);
    if (existingRegulator) {
      toast.error('Un régulateur de tension existe déjà sur ce nœud');
      return;
    }

    // Déterminer automatiquement le type selon la tension de la source
    const sourceNode = currentProject.nodes.find(n => n.isSource);
    const sourceVoltage = sourceNode?.tensionCible || (currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230);
    const type = sourceVoltage > 300 ? '400V' : '230V';
    
    const regulatorType: RegulatorType = type === '230V' ? '230V_77kVA' : '400V_44kVA';
    const maxPower = type === '230V' ? 77 : 44;
    const targetVoltage = type === '230V' ? 230 : 400;

    const newRegulator: VoltageRegulator = {
      id: `regulator-${nodeId}-${Date.now()}`,
      nodeId,
      type: regulatorType,
      targetVoltage_V: targetVoltage,
      maxPower_kVA: maxPower,
      enabled: true
    };

    set({
      simulationEquipment: {
        ...simulationEquipment,
        regulators: [...simulationEquipment.regulators, newRegulator]
      }
    });
    
    toast.success(`Armoire de régulation ${type} ajoutée`);
    
    // Recalculer automatiquement la simulation
    get().runSimulation();
  },

  removeVoltageRegulator: (regulatorId: string) => {
    const { simulationEquipment } = get();
    set({
      simulationEquipment: {
        ...simulationEquipment,
        regulators: simulationEquipment.regulators.filter(r => r.id !== regulatorId)
      }
    });
    toast.success('Régulateur de tension supprimé');
  },

  updateVoltageRegulator: (regulatorId: string, updates: Partial<VoltageRegulator>) => {
    const { simulationEquipment } = get();
    set({
      simulationEquipment: {
        ...simulationEquipment,
        regulators: simulationEquipment.regulators.map(r => 
          r.id === regulatorId ? { ...r, ...updates } : r
        )
      }
    });
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
      zPhase_Ohm: 0.5,
      zNeutral_Ohm: 0.2,
      fraction: 0.6
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
    const { simulationEquipment } = get();
    set({
      simulationEquipment: {
        ...simulationEquipment,
        neutralCompensators: simulationEquipment.neutralCompensators.map(c => 
          c.id === compensatorId ? { ...c, ...updates } : c
        )
      }
    });
  },

  proposeCableUpgrades: () => {
    const { currentProject, calculationResults, selectedScenario, simulationEquipment } = get();
    if (!currentProject || !calculationResults[selectedScenario]) return;

    const result = calculationResults[selectedScenario]!;
    // Utiliser le SimulationCalculator pour proposer des améliorations
    const calculator = new ElectricalCalculator();
    // Fallback simple pour proposer des améliorations
    const upgrades: CableUpgrade[] = [];
    
    // Logique simplifiée pour détecter les câbles à améliorer
    for (const cable of result.cables) {
      if (cable.voltageDropPercent && Math.abs(cable.voltageDropPercent) > 8) {
        // Trouver un câble de section supérieure (approximation)
        const currentType = currentProject.cableTypes.find(t => t.id === cable.typeId);
        const betterType = currentProject.cableTypes.find(t => 
          t.R12_ohm_per_km < (currentType?.R12_ohm_per_km || 1) && 
          t.matiere === currentType?.matiere
        );
        
        if (betterType) {
          upgrades.push({
            originalCableId: cable.id,
            newCableTypeId: betterType.id,
            reason: 'voltage_drop',
            before: {
              voltageDropPercent: cable.voltageDropPercent,
              current_A: cable.current_A || 0,
              losses_kW: cable.losses_kW || 0
            },
            after: {
              voltageDropPercent: cable.voltageDropPercent * 0.7, // Amélioration estimée
              current_A: cable.current_A || 0,
              losses_kW: (cable.losses_kW || 0) * 0.5,
              estimatedCost: 1500
            },
            improvement: {
              voltageDropReduction: Math.abs(cable.voltageDropPercent) * 0.3,
              lossReduction_kW: (cable.losses_kW || 0) * 0.5,
              lossReductionPercent: 50
            }
          });
        }
      }
    }

    set({
      simulationEquipment: {
        ...simulationEquipment,
        cableUpgrades: upgrades
      }
    });
    
    toast.success(`${upgrades.length} améliorations de câbles proposées`);
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
        PRODUCTION: null
      };
      
      const scenarios: CalculationScenario[] = ['PRÉLÈVEMENT', 'MIXTE', 'PRODUCTION'];
      
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
      
      const activeEquipmentCount = simulationEquipment.regulators.filter(r => r.enabled).length + 
                                  simulationEquipment.neutralCompensators.filter(c => c.enabled).length;
      
      toast.success(`Simulation recalculée avec ${activeEquipmentCount} équipement(s) actif(s)`);
    } catch (error) {
      console.error('Erreur lors de la simulation:', error);
      toast.error('Erreur lors du calcul de simulation');
    }
  }
}));