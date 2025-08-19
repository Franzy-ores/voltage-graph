import { create } from 'zustand';
import { NetworkState, Project, Node, Cable, CalculationScenario, CalculationResult, VoltageSystem, ConnectionType } from '@/types/network';
import { defaultCableTypes } from '@/data/defaultCableTypes';
import { ElectricalCalculator } from '@/utils/electricalCalculations';

interface NetworkStoreState extends NetworkState {
  selectedCableType: string;
}

interface NetworkActions {
  // Project actions
  createNewProject: (name: string, voltageSystem: VoltageSystem) => void;
  loadProject: (project: Project) => void;
  updateProjectConfig: (updates: Partial<Pick<Project, 'name' | 'voltageSystem' | 'cosPhi'>>) => void;
  
  // Node actions
  addNode: (lat: number, lng: number, connectionType: ConnectionType) => void;
  updateNode: (nodeId: string, updates: Partial<Node>) => void;
  deleteNode: (nodeId: string) => void;
  
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
  openEditPanel: (target: 'node' | 'cable' | 'project') => void;
  closeEditPanel: () => void;
  
  // Calculations
  calculateAll: () => void;
  
  // Validation
  validateConnectionType: (connectionType: ConnectionType, voltageSystem: VoltageSystem) => boolean;
  
  // Display settings
  setShowVoltages: (show: boolean) => void;
}

const createDefaultProject = (name: string, voltageSystem: VoltageSystem): Project => ({
  id: `project-${Date.now()}`,
  name,
  voltageSystem,
  cosPhi: 0.95,
  nodes: [],
  cables: [],
  cableTypes: [...defaultCableTypes]
});

export const useNetworkStore = create<NetworkStoreState & NetworkActions>((set, get) => ({
  // State
  currentProject: createDefaultProject("Projet par défaut", "TÉTRAPHASÉ_400V"),
  selectedScenario: 'MIXTE',
  calculationResults: {
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

  // Actions
  createNewProject: (name, voltageSystem) => {
    const project = createDefaultProject(name, voltageSystem);
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
    set({ 
      currentProject: project,
      selectedNodeId: null,
      selectedCableId: null,
      editPanelOpen: false
    });
  },

  updateProjectConfig: (updates) => {
    const { currentProject } = get();
    if (!currentProject) return;
    
    set({
      currentProject: { ...currentProject, ...updates }
    });
  },

  addNode: (lat, lng, connectionType) => {
    const { currentProject } = get();
    if (!currentProject) return;

    // Déterminer le type de connexion selon le système de tension du projet
    let nodeConnectionType: ConnectionType;
    if (currentProject.voltageSystem === 'TRIPHASÉ_230V') {
      nodeConnectionType = 'TRI_230V_3F'; // 230V par défaut en monophasé
    } else {
      nodeConnectionType = 'TÉTRA_3P+N_230_400V'; // 400V par défaut en monophasé
    }

    const newNode: Node = {
      id: `node-${Date.now()}`,
      name: `Nœud ${currentProject.nodes.length + 1}`,
      lat,
      lng,
      connectionType: nodeConnectionType,
      clients: currentProject.nodes.length === 0 ? [] : [{ id: `client-${Date.now()}`, label: 'Charge 1', S_kVA: 5 }],
      productions: currentProject.nodes.length === 0 ? [] : [{ id: `prod-${Date.now()}`, label: 'PV 1', S_kVA: 5 }],
      isSource: currentProject.nodes.length === 0 // Premier nœud = source
    };

    set({
      currentProject: {
        ...currentProject,
        nodes: [...currentProject.nodes, newNode]
      }
    });
  },

  updateNode: (nodeId, updates) => {
    const { currentProject } = get();
    if (!currentProject) return;

    set({
      currentProject: {
        ...currentProject,
        nodes: currentProject.nodes.map(node =>
          node.id === nodeId ? { ...node, ...updates } : node
        )
      }
    });
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
  setSelectedScenario: (scenario) => set({ selectedScenario: scenario }),
  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),
  setSelectedCable: (cableId) => set({ selectedCableId: cableId }),
  setSelectedCableType: (cableTypeId) => set({ selectedCableType: cableTypeId }),

  openEditPanel: (target) => set({ 
    editPanelOpen: true, 
    editTarget: target 
  }),

  closeEditPanel: () => set({ 
    editPanelOpen: false, 
    editTarget: null 
  }),

  calculateAll: () => {
    const { currentProject } = get();
    if (!currentProject) return;

    const calculator = new ElectricalCalculator(currentProject.cosPhi);
    
    const results = {
      PRÉLÈVEMENT: calculator.calculateScenario(
        currentProject.nodes, 
        currentProject.cables, 
        currentProject.cableTypes, 
        'PRÉLÈVEMENT'
      ),
      MIXTE: calculator.calculateScenario(
        currentProject.nodes, 
        currentProject.cables, 
        currentProject.cableTypes, 
        'MIXTE'
      ),
      PRODUCTION: calculator.calculateScenario(
        currentProject.nodes, 
        currentProject.cables, 
        currentProject.cableTypes, 
        'PRODUCTION'
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

  setShowVoltages: (show) => set({ showVoltages: show })
}));