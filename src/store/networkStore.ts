import { create } from 'zustand';
import { NetworkState, Project, Node, Cable, CalculationScenario, CalculationResult, VoltageSystem, ConnectionType } from '@/types/network';
import { defaultCableTypes } from '@/data/defaultCableTypes';
import { ElectricalCalculator } from '@/utils/electricalCalculations';
import { toast } from 'sonner';

interface NetworkStoreState extends NetworkState {
  selectedCableType: string;
}

interface NetworkActions {
  // Project actions
  createNewProject: (name: string, voltageSystem: VoltageSystem) => void;
  loadProject: (project: Project) => void;
  updateProjectConfig: (updates: Partial<Pick<Project, 'name' | 'voltageSystem' | 'cosPhi' | 'foisonnementCharges' | 'foisonnementProductions' | 'defaultChargeKVA' | 'defaultProductionKVA'>>) => void;
  
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
  changeVoltageSystem: () => void;
  setFoisonnementCharges: (value: number) => void;
  setFoisonnementProductions: (value: number) => void;
  calculateWithTargetVoltage: (nodeId: string, targetVoltage: number) => void;
}

const createDefaultProject = (): Project => ({
  id: `project-${Date.now()}`,
  name: "Nouveau Projet",
  voltageSystem: "TÉTRAPHASÉ_400V",
  cosPhi: 0.95,
  foisonnementCharges: 100,
  foisonnementProductions: 100,
  defaultChargeKVA: 5,
  defaultProductionKVA: 5,
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
  defaultChargeKVA: 5,
  defaultProductionKVA: 5,
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
  selectedTool: 'select',
  selectedNodeId: null,
  selectedCableId: null,
  selectedCableType: 'baxb-95', // Par défaut, câble aérien
  editPanelOpen: false,
  editTarget: null,
  showVoltages: false,

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
    set({ 
      currentProject: project,
      selectedNodeId: null,
      selectedCableId: null,
      editPanelOpen: false
    });
    
    // Déclencher le zoom sur le projet chargé après un court délai
    setTimeout(() => {
      const event = new CustomEvent('zoomToProject');
      window.dispatchEvent(event);
    }, 100);
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
      clients: currentProject.nodes.length === 0 ? [] : [{ 
        id: `client-${Date.now()}`, 
        label: 'Charge 1', 
        S_kVA: currentProject.defaultChargeKVA || 5 
      }],
      productions: currentProject.nodes.length === 0 ? [] : [{ 
        id: `prod-${Date.now()}`, 
        label: 'PV 1', 
        S_kVA: currentProject.defaultProductionKVA || 5 
      }],
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
        'PRÉLÈVEMENT',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions
      ),
      MIXTE: calculator.calculateScenario(
        currentProject.nodes, 
        currentProject.cables, 
        currentProject.cableTypes, 
        'MIXTE',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions
      ),
      PRODUCTION: calculator.calculateScenario(
        currentProject.nodes, 
        currentProject.cables, 
        currentProject.cableTypes, 
        'PRODUCTION',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions
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
    const { currentProject } = get();
    if (!currentProject) return;

    const newVoltageSystem: VoltageSystem = 
      currentProject.voltageSystem === 'TRIPHASÉ_230V' ? 'TÉTRAPHASÉ_400V' : 'TRIPHASÉ_230V';
    
    // Déterminer le nouveau type de connexion par défaut selon le système
    const newConnectionType: ConnectionType = 
      newVoltageSystem === 'TÉTRAPHASÉ_400V' ? 'TÉTRA_3P+N_230_400V' : 'TRI_230V_3F';

    // Mettre à jour le projet avec le nouveau système et tous les nœuds
    const updatedProject = {
      ...currentProject,
      voltageSystem: newVoltageSystem,
      nodes: currentProject.nodes.map(node => ({
        ...node,
        connectionType: node.isSource ? newConnectionType : newConnectionType
      }))
    };

    set({ currentProject: updatedProject });

    // Déclencher un recalcul automatique
    const calculator = new ElectricalCalculator(updatedProject.cosPhi);
    
    const results = {
      PRÉLÈVEMENT: calculator.calculateScenario(
        updatedProject.nodes, 
        updatedProject.cables, 
        updatedProject.cableTypes, 
        'PRÉLÈVEMENT',
        updatedProject.foisonnementCharges,
        updatedProject.foisonnementProductions
      ),
      MIXTE: calculator.calculateScenario(
        updatedProject.nodes, 
        updatedProject.cables, 
        updatedProject.cableTypes, 
        'MIXTE',
        updatedProject.foisonnementCharges,
        updatedProject.foisonnementProductions
      ),
      PRODUCTION: calculator.calculateScenario(
        updatedProject.nodes, 
        updatedProject.cables, 
        updatedProject.cableTypes, 
        'PRODUCTION',
        updatedProject.foisonnementCharges,
        updatedProject.foisonnementProductions
      )
    };

    set({ calculationResults: results });
  },

  setFoisonnementCharges: (value: number) => {
    const { currentProject, calculateAll } = get();
    if (!currentProject) return;

    set({
      currentProject: {
        ...currentProject,
        foisonnementCharges: Math.max(0, Math.min(100, value))
      }
    });
    calculateAll();
  },

  setFoisonnementProductions: (value: number) => {
    const { currentProject, calculateAll } = get();
    if (!currentProject) return;

    set({
      currentProject: {
        ...currentProject,
        foisonnementProductions: Math.max(0, Math.min(100, value))
      }
    });
    calculateAll();
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
  }
}));