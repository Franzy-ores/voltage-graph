import { describe, it, expect, beforeEach } from 'vitest';
import { SimulationCalculator } from '@/utils/simulationCalculator';
import type { Project, SRG2Config } from '@/types/network';
import { defaultCableTypes } from '@/data/defaultCableTypes';

describe('SRG2 Regulator Integration', () => {
  let calculator: SimulationCalculator;

  beforeEach(() => {
    calculator = new SimulationCalculator();
  });

  const createTestProject = (): Project => ({
    id: 'test-integration',
    name: 'Test Integration Project',
    voltageSystem: "TÉTRAPHASÉ_400V",
    cosPhi: 0.95,
    foisonnementCharges: 80,
    foisonnementProductions: 90,
    defaultChargeKVA: 10,
    defaultProductionKVA: 5,
    transformerConfig: {
      rating: "160kVA",
      nominalPower_kVA: 160,
      nominalVoltage_V: 400,
      shortCircuitVoltage_percent: 4.0,
      cosPhi: 0.95
    },
    loadModel: 'polyphase_equilibre',
    desequilibrePourcent: 0,
    manualPhaseDistribution: {
      charges: { A: 33.33, B: 33.33, C: 33.34 },
      productions: { A: 33.33, B: 33.33, C: 33.34 },
      constraints: { min: -20, max: 20, total: 100 }
    },
    nodes: [
      {
        id: 'source_node',
        name: 'Source Node',
        lat: 46.6167,
        lng: 6.8833,
        connectionType: "TÉTRA_3P+N_230_400V",
        clients: [],
        productions: [],
        isSource: true
      },
      {
        id: 'srg2_node',
        name: 'SRG2 Node',
        lat: 46.6170,
        lng: 6.8835,
        connectionType: "TÉTRA_3P+N_230_400V",
        clients: [{ id: 'load1', label: 'Load 1', S_kVA: 25 }],
        productions: [{ id: 'pv1', label: 'PV 1', S_kVA: 15 }],
        isSource: false,
        tensionCible: 420
      },
      {
        id: 'load_node',
        name: 'Load Node',
        lat: 46.6175,
        lng: 6.8840,
        connectionType: "TÉTRA_3P+N_230_400V",
        clients: [{ id: 'load2', label: 'Load 2', S_kVA: 30 }],
        productions: [],
        isSource: false
      }
    ],
    cables: [
      {
        id: 'cable1',
        name: 'Main Cable',
        typeId: 'baxb-95',
        pose: "AÉRIEN",
        nodeAId: 'source_node',
        nodeBId: 'srg2_node',
        coordinates: [
          { lat: 46.6167, lng: 6.8833 },
          { lat: 46.6170, lng: 6.8835 }
        ],
        length_m: 100
      },
      {
        id: 'cable2',
        name: 'Secondary Cable',
        typeId: 'baxb-70',
        pose: "AÉRIEN",
        nodeAId: 'srg2_node',
        nodeBId: 'load_node',
        coordinates: [
          { lat: 46.6170, lng: 6.8835 },
          { lat: 46.6175, lng: 6.8840 }
        ],
        length_m: 150
      }
    ],
    cableTypes: defaultCableTypes
  });

  const createSRG2Config = (): SRG2Config => ({
    nodeId: 'srg2_node',
    enabled: true
  });

  it('should handle SRG2 regulation with diversity factors', () => {
    const project = createTestProject();
    const srg2Config = createSRG2Config();
    
    const result = calculator.calculateWithSimulation(
      project,
      'MIXTE',
      { srg2: srg2Config, neutralCompensators: [], cableUpgrades: [] }
    );

    expect(result.srg2Result).toBeDefined();
    expect(result.srg2Result?.diversifiedLoad_kVA).toBeDefined();
    expect(result.srg2Result?.diversifiedProduction_kVA).toBeDefined();
  });

  it('should respect fixed power limits', () => {
    const project = createTestProject();
    const srg2Config = createSRG2Config();
    
    const targetNode = project.nodes.find(n => n.id === 'srg2_node')!;
    targetNode.tensionCible = 420;
    
    // Add high power load - should not exceed 100 kVA limit
    const loadNode = project.nodes.find(n => n.id === 'load_node')!;
    loadNode.clients = [{ id: 'big_load', label: 'Big Load', S_kVA: 80 }];
    
    const result = calculator.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      { srg2: srg2Config, neutralCompensators: [], cableUpgrades: [] }
    );

    expect(result.srg2Result).toBeDefined();
    expect(result.srg2Result?.powerDownstream_kVA).toBeLessThanOrEqual(100);
  });

  it('should derive network type from project voltage system', () => {
    const project = createTestProject();
    project.voltageSystem = "TRIPHASÉ_230V";
    project.transformerConfig.nominalVoltage_V = 230;
    
    const srg2Config: SRG2Config = {
      nodeId: 'srg2_node',
      enabled: true
    };
    
    const result = calculator.calculateWithSimulation(
      project,
      'MIXTE',
      { srg2: srg2Config, neutralCompensators: [], cableUpgrades: [] }
    );

    expect(result.srg2Result?.networkType).toBe('230V');
  });
});