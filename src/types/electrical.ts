export interface NetworkNode {
  id: string;
  x: number;
  y: number;
  name: string;
  loads: Load[];
  productions: Production[];
}

export interface Load {
  id: string;
  power: number; // kVA
  name: string;
}

export interface Production {
  id: string;
  power: number; // kVA
  name: string;
  type: 'PV' | 'Other';
}

export interface Cable {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: CableType;
  length: number; // meters
  current?: number; // Amperes
  voltageDrop?: number; // Volts
  voltageDropPercent?: number; // %
  losses?: number; // kW
}

export interface CableType {
  id: string;
  name: string;
  r12: number; // Ohm/km
  x12: number; // Ohm/km
  r0: number; // Ohm/km
  x0: number; // Ohm/km
  material: 'Aluminium' | 'Copper';
}

export interface NetworkConfig {
  voltage: 230 | 400; // Volts
  phaseType: 'triphasé' | 'tétraphasé';
  cosPhi: number;
}

export type CalculationScenario = 'consumption' | 'mixed' | 'production';

export interface CalculationResult {
  scenario: CalculationScenario;
  cables: Cable[];
  totalLoads: number; // kVA
  totalProductions: number; // kVA
  globalLosses: number; // kW
  maxVoltageDrop: number; // %
  compliance: 'normal' | 'warning' | 'critical'; // Based on EN 50160
}

export interface NetworkState {
  nodes: NetworkNode[];
  cables: Cable[];
  config: NetworkConfig;
  selectedTool: 'select' | 'addNode' | 'addCable' | 'delete';
  selectedScenario: CalculationScenario;
  calculationResults: {
    consumption: CalculationResult | null;
    mixed: CalculationResult | null;
    production: CalculationResult | null;
  };
}