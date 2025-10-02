export type VoltageSystem = "TRIPHASÉ_230V" | "TÉTRAPHASÉ_400V";

export type ConnectionType =
  // Réseau 230V :
  | "MONO_230V_PP"      // monophasé 230 V entre 2 phases (réseau 230V)
  | "TRI_230V_3F"       // triphasé 230 V (3 fils)
  // Réseau 400V :
  | "MONO_230V_PN"      // monophasé 230 V phase-neutre (réseau 400V)
  | "TÉTRA_3P+N_230_400V"; // tétraphasé 3P+N (230/400V), usage 230V par phase

export type CablePose = "AÉRIEN" | "SOUTERRAIN";

export type CalculationScenario = "PRÉLÈVEMENT" | "MIXTE" | "PRODUCTION" | "FORCÉ";

export type LoadModel = 'monophase_reparti' | 'polyphase_equilibre';

// Import du type SRG2Config
import { SRG2Config } from './srg2';

// Types pour le transformateur HT1/BT
export type TransformerRating = "160kVA" | "250kVA" | "400kVA" | "630kVA";

export interface TransformerConfig {
  rating: TransformerRating;
  nominalPower_kVA: number;    // Puissance nominale en kVA
  nominalVoltage_V: number;    // Tension nominale BT en V (230 ou 400)
  shortCircuitVoltage_percent: number; // Tension de court-circuit en %
  cosPhi: number;              // Facteur de puissance (peut être utilisé ailleurs, mais pas pour Ztr)
  xOverR?: number;             // Ratio X/R du transformateur (optionnel)
}

// Interface pour le jeu de barres virtuel
export interface VirtualBusbar {
  voltage_V: number;          // tension au jeu de barres après ΔU global (ligne)
  current_A: number;          // courant net (RMS)
  current_N?: number;         // courant neutre (A RMS) en mode déséquilibré 400V
  netSkVA: number;            // total charges - productions (kVA)
  deltaU_V: number;           // ΔU global appliqué au bus (V, ligne)
  deltaU_percent?: number;    // ΔU global en %/U_line
  losses_kW?: number;         // pertes cuivre transfo (kW)
  circuits: Array<{
    circuitId: string;
    subtreeSkVA: number;      // charges - productions du sous-arbre (kVA)
    subtreeQkVAr?: number;    // puissance réactive du sous-arbre (kVAr)
    direction: 'injection' | 'prélèvement';
    current_A: number;        // courant du départ (A RMS)
    deltaU_V: number;         // ΔU proportionnel au départ (V)
    voltageBus_V: number;     // tension du bus (V)
    minNodeVoltage_V: number; // tension min dans le sous-arbre (V ligne)
    maxNodeVoltage_V: number; // tension max dans le sous-arbre (V ligne)
    nodesCount: number;       // nombre de nœuds dans le sous-arbre
  }>;
}

export interface CableType {
  id: string;
  label: string;       // ex: "BAXB 95"
  R12_ohm_per_km: number;
  X12_ohm_per_km: number;
  R0_ohm_per_km: number;
  X0_ohm_per_km: number;
  matiere: "CUIVRE" | "ALUMINIUM";
  posesPermises: CablePose[];
  maxCurrent_A?: number; // Ampacité (I_iz) optionnelle si disponible
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
  connectionType: ConnectionType; // Temporairement maintenu pour éviter trop de cassures
  clients: ClientCharge[];
  productions: ProductionPV[];
  isSource?: boolean;
  tensionCible?: number; // tension cible en V (optionnel)
  // Tensions cibles par phase (pour mode monophasé déséquilibré)
  tensionCiblePhaseA?: number;
  tensionCiblePhaseB?: number;
  tensionCiblePhaseC?: number;
  // SRG2 regulation properties (transformer approach)
  hasSRG2Device?: boolean; // indique si ce nœud a un dispositif SRG2
  srg2RegulationCoefficients?: {A: number, B: number, C: number}; // coefficients de régulation SRG2 en % (multiplicateurs)
  // Répartition des charges et productions par phase (mode monophasé)
  phaseDistribution?: {
    charges?: { A: number; B: number; C: number };
    productions?: { A: number; B: number; C: number };
  };
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
  // Résultats de calcul (agrégés)
  current_A?: number;
  voltageDrop_V?: number;
  voltageDropPercent?: number;
  losses_kW?: number;
  apparentPower_kVA?: number;
  // Résultats détaillés par phase (optionnels, si déséquilibré)
  currentsPerPhase_A?: { A: number; B: number; C: number; N?: number };
  voltageDropPerPhase_V?: { A: number; B: number; C: number };
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
  totalLoad_kVA?: number; // charge totale du réseau (kVA) - pour estimation initiale
  totalProd_kVA?: number; // production totale du réseau (kVA) - pour estimation initiale
  transformerConfig: TransformerConfig; // Configuration du transformateur HT1/BT
  // Configuration tension HT pour calcul source réaliste
  htVoltageConfig?: {
    nominalVoltageHT_V: number;    // Tension nominale HT (V) - ex: 20000V
    nominalVoltageBT_V: number;    // Tension nominale BT (V) - ex: 400V
    measuredVoltageHT_V: number;   // Tension HT mesurée (V)
  };
  // Nouveau: modèle de charge et taux de déséquilibre
  loadModel?: LoadModel; // 'polyphase_equilibre' par défaut (compatibilité)
  desequilibrePourcent?: number; // 0 à 100, uniquement si loadModel = 'monophase_reparti'
  // Configuration mode forcé
  forcedModeConfig?: {
    measuredVoltages: {
      U1: number;
      U2: number;
      U3: number;
    };
    measurementNodeId: string;
    // Calibration: tension cible (nuit). 0 => pas de calibration, utiliser le foisonnement manuel
    targetVoltage?: number;
  };
  geographicBounds?: { // coordonnées géographiques du projet
    north: number;
    south: number;
    east: number;
    west: number;
    center: { lat: number; lng: number };
    zoom: number;
  };
  // Répartition manuelle des phases (charges et productions)
  manualPhaseDistribution?: {
    charges: { A: number; B: number; C: number };
    productions: { A: number; B: number; C: number };
    constraints: { min: number; max: number; total: number };
  };
  nodes: Node[];
  cables: Cable[];
  cableTypes: CableType[];
}


// Types pour les équipements de simulation
// SUPPRIMÉ - RegulatorType et VoltageRegulator

export interface NeutralCompensator {
  id: string;
  nodeId: string; // Nœud où le compensateur est installé
  maxPower_kVA: number; // Puissance totale disponible pour compensation
  tolerance_A: number; // Seuil de courant de neutre pour déclencher la compensation
  enabled: boolean; // Actif dans la simulation
  // Paramètres EQUI8 (modèle CME Transformateur)
  Zph_Ohm: number; // Impédance câble phase réseau (Ω) - doit être > 0,15 Ω
  Zn_Ohm: number;  // Impédance câble neutre réseau (Ω) - doit être > 0,15 Ω
  // Résultats de simulation EQUI8
  currentIN_A?: number; // Courant de neutre final I-EQUI8 (A)
  reductionPercent?: number; // Pourcentage de réduction du courant de neutre
  isLimited?: boolean; // True si limitation par puissance atteinte
  // Tensions et courants EQUI8
  iN_initial_A?: number;    // Courant de neutre initial (A)
  iN_absorbed_A?: number;   // Courant de neutre absorbé par EQUI8 (A)
  u1p_V?: number;           // UEQUI8-ph1 : Tension phase A après EQUI8 (V)
  u2p_V?: number;           // UEQUI8-ph2 : Tension phase B après EQUI8 (V)
  u3p_V?: number;           // UEQUI8-ph3 : Tension phase C après EQUI8 (V)
  // Métriques intermédiaires EQUI8
  umoy_init_V?: number;     // Moyenne des tensions initiales
  umax_init_V?: number;     // Max des tensions initiales
  umin_init_V?: number;     // Min des tensions initiales
  ecart_init_V?: number;    // (Umax-Umin)init
  ecart_equi8_V?: number;   // (Umax-Umin)EQUI8 après compensation
  compensationQ_kVAr?: { A: number; B: number; C: number }; // Q par phase (si modélisé)
}

export interface CableUpgrade {
  originalCableId: string;
  newCableTypeId: string;
  reason: 'voltage_drop' | 'overload' | 'both';
  // Comparaison avant/après
  before: {
    voltageDropPercent: number;
    current_A: number;
    losses_kW: number;
  };
  after: {
    voltageDropPercent: number;
    current_A: number;
    losses_kW: number;
    estimatedCost?: number;
  };
  improvement: {
    voltageDropReduction: number; // En %
    lossReduction_kW: number;
    lossReductionPercent: number;
  };
}

export interface SimulationEquipment {
  srg2Devices: SRG2Config[]; // Nouveau: dispositifs SRG2
  neutralCompensators: NeutralCompensator[];
  cableUpgrades: CableUpgrade[];
}

export interface SimulationResult extends CalculationResult {
  isSimulation: boolean;
  equipment?: SimulationEquipment;
  baselineResult?: CalculationResult; // Résultats sans équipements pour comparaison
  convergenceStatus?: 'converged' | 'not_converged';
}

export interface CalculationResult {
  scenario: CalculationScenario;
  cables: Cable[];
  totalLoads_kVA: number;
  totalProductions_kVA: number;
  globalLosses_kW: number;
  maxVoltageDropPercent: number;
  maxVoltageDropCircuitNumber?: number; // Numéro de circuit avec la chute maximale
  compliance: 'normal' | 'warning' | 'critical';
  nodeVoltageDrops?: { nodeId: string; deltaU_cum_V: number; deltaU_cum_percent: number }[];
  nodeMetrics?: { nodeId: string; V_phase_V: number; V_pu: number; I_inj_A: number }[];
  nodePhasors?: { nodeId: string; V_real: number; V_imag: number; V_phase_V: number; V_angle_deg: number }[];
  nodePhasorsPerPhase?: { nodeId: string; phase: 'A' | 'B' | 'C'; V_real: number; V_imag: number; V_phase_V: number; V_angle_deg: number }[];
  nodeMetricsPerPhase?: { 
    nodeId: string; 
    voltagesPerPhase: { A: number; B: number; C: number };
    voltageDropsPerPhase: { A: number; B: number; C: number };
    compliancePerPhase?: { A: 'normal' | 'warning' | 'critical'; B: 'normal' | 'warning' | 'critical'; C: 'normal' | 'warning' | 'critical' };
    nodeCompliance?: 'normal' | 'warning' | 'critical';
  }[];
  cablePowerFlows?: { cableId: string; P_kW: number; Q_kVAr: number; S_kVA: number; pf: number }[];
  virtualBusbar?: VirtualBusbar; // Informations du jeu de barres virtuel
  manualPhaseDistribution?: {
    charges: { A: number; B: number; C: number };
    productions: { A: number; B: number; C: number };
  };
  // Propriétés spécifiques au mode forcé
  convergenceStatus?: 'converged' | 'not_converged';
  finalLoadDistribution?: { A: number; B: number; C: number };
  finalProductionDistribution?: { A: number; B: number; C: number };
  calibratedFoisonnementCharges?: number;
  optimizedPhaseDistribution?: {
    charges: { A: number; B: number; C: number };
    productions: { A: number; B: number; C: number };
    constraints: { min: number; max: number; total: number };
  };
}

export interface NetworkState {
  currentProject: Project | null;
  selectedScenario: CalculationScenario;
  calculationResults: {
    [key in CalculationScenario]: CalculationResult | null;
  };
  simulationResults: {
    [key in CalculationScenario]: SimulationResult | null;
  };
  selectedTool: 'select' | 'addNode' | 'addCable' | 'edit' | 'delete' | 'move' | 'simulation';
  selectedNodeId: string | null;
  selectedCableId: string | null;
  editPanelOpen: boolean;
  editTarget: 'node' | 'cable' | 'project' | 'simulation' | null;
  showVoltages: boolean;
  resultsPanelOpen: boolean;
  focusMode: boolean;
  simulationMode: boolean;
  simulationEquipment: SimulationEquipment;
}