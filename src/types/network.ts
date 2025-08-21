export type VoltageSystem = "TRIPHASÉ_230V" | "TÉTRAPHASÉ_400V";

export type ConnectionType =
  // Réseau 230V :
  | "MONO_230V_PP"      // monophasé 230 V entre 2 phases (réseau 230V)
  | "TRI_230V_3F"       // triphasé 230 V (3 fils)
  // Réseau 400V :
  | "MONO_230V_PN"      // monophasé 230 V phase-neutre (réseau 400V)
  | "TÉTRA_3P+N_230_400V"; // tétraphasé 3P+N (230/400V), usage 230V par phase

export type CablePose = "AÉRIEN" | "SOUTERRAIN";

export type CalculationScenario = "PRÉLÈVEMENT" | "MIXTE" | "PRODUCTION";

export interface CableType {
  id: string;
  label: string;       // ex: "BAXB 95"
  R12_ohm_per_km: number;
  X12_ohm_per_km: number;
  R0_ohm_per_km: number;
  X0_ohm_per_km: number;
  matiere: "ALUMINIUM";
  posesPermises: CablePose[];
}

export interface ClientCharge {
  id: string;
  label: string;
  S_kVA: number; // par défaut 5 kVA
}

export interface ProductionPV {
  id: string;
  label: string;
  S_kVA: number; // par défaut 5 kVA
}

export interface Node {
  id: string;
  name: string;
  lat: number;
  lng: number;
  connectionType: ConnectionType;
  clients: ClientCharge[];
  productions: ProductionPV[];
  isSource?: boolean;
  tensionCible?: number; // tension cible en V (optionnel)
}

export interface Cable {
  id: string;
  name: string;
  typeId: string;
  pose: CablePose;
  nodeAId: string;
  nodeBId: string;
  coordinates: { lat: number; lng: number; }[];
  length_m?: number; // calculée automatiquement
  // Résultats de calcul
  current_A?: number;
  voltageDrop_V?: number;
  voltageDropPercent?: number;
  losses_kW?: number;
}

export interface Project {
  id: string;
  name: string;
  voltageSystem: VoltageSystem;
  cosPhi: number; // facteur de puissance global
  foisonnementCharges: number; // facteur de foisonnement des charges (0-100%)
  foisonnementProductions: number; // facteur de foisonnement des productions (0-100%)
  defaultChargeKVA: number; // charge par défaut pour nouveaux nœuds (kVA)
  defaultProductionKVA: number; // production par défaut pour nouveaux nœuds (kVA)
  nodes: Node[];
  cables: Cable[];
  cableTypes: CableType[];
}

export interface CalculationResult {
  scenario: CalculationScenario;
  cables: Cable[];
  totalLoads_kVA: number;
  totalProductions_kVA: number;
  globalLosses_kW: number;
  maxVoltageDropPercent: number;
  compliance: 'normal' | 'warning' | 'critical';
  nodeVoltageDrops?: { nodeId: string; deltaU_cum_V: number; deltaU_cum_percent: number }[];
}

export interface NetworkState {
  currentProject: Project | null;
  selectedScenario: CalculationScenario;
  calculationResults: {
    [key in CalculationScenario]: CalculationResult | null;
  };
  selectedTool: 'select' | 'addNode' | 'addCable' | 'edit' | 'delete' | 'move';
  selectedNodeId: string | null;
  selectedCableId: string | null;
  editPanelOpen: boolean;
  editTarget: 'node' | 'cable' | 'project' | null;
  showVoltages: boolean;
}