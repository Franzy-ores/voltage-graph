import { describe, it, expect, beforeEach } from 'vitest';
import { SimulationCalculator } from '../simulationCalculator';
import { Node, Cable, CableType, Project, SimulationEquipment, VoltageRegulator } from '../../types/network';

describe('SRG2 Interference Prevention', () => {
  let calculator: SimulationCalculator;
  let mockProject: Partial<Project>;
  let mockNodes: Node[];
  let mockCables: Cable[];
  let mockCableTypes: CableType[];

  beforeEach(() => {
    calculator = new SimulationCalculator();
    
    // Mock project configuration
    mockProject = {
      id: 'test-project',
      name: 'Test SRG2 Interference',
      transformerConfig: {
        rating: '160kVA',
        nominalVoltage_V: 230,
        nominalPower_kVA: 160,
        shortCircuitVoltage_percent: 4,
        cosPhi: 0.9
      },
      voltageSystem: 'TRIPHASÉ_230V',
      loadModel: 'polyphase_equilibre',
      cosPhi: 0.9,
      foisonnementCharges: 1.0,
      foisonnementProductions: 1.0,
      desequilibrePourcent: 0
    };

    // Mock nodes - node1 will be SRG2, node2 will be classical regulator
    mockNodes = [
      {
        id: 'source',
        name: 'Source',
        lat: 0,
        lng: 0,
        connectionType: 'TÉTRA_3P+N_230_400V',
        clients: [],
        productions: [],
        isSource: true,
        tensionCible: 230
      },
      {
        id: 'srg2-node',
        name: 'SRG2 Node',
        lat: 0.001,
        lng: 0,
        connectionType: 'TÉTRA_3P+N_230_400V',
        clients: [{ id: 'client1', label: 'Client 1', S_kVA: 10 }],
        productions: []
      },
      {
        id: 'classical-node',
        name: 'Classical Node',
        lat: 0.002,
        lng: 0,
        connectionType: 'TÉTRA_3P+N_230_400V',
        clients: [{ id: 'client2', label: 'Client 2', S_kVA: 15 }],
        productions: []
      }
    ];

    // Mock cables
    mockCables = [
      {
        id: 'cable1',
        name: 'Cable 1',
        typeId: 'test-cable',
        pose: 'SOUTERRAIN',
        nodeAId: 'source',
        nodeBId: 'srg2-node',
        coordinates: [
          { lat: 0, lng: 0 },
          { lat: 0.001, lng: 0 }
        ],
        length_m: 100
      },
      {
        id: 'cable2',
        name: 'Cable 2',
        typeId: 'test-cable',
        pose: 'SOUTERRAIN',
        nodeAId: 'srg2-node',
        nodeBId: 'classical-node',
        coordinates: [
          { lat: 0.001, lng: 0 },
          { lat: 0.002, lng: 0 }
        ],
        length_m: 100
      }
    ];

    // Mock cable types
    mockCableTypes = [
      {
        id: 'test-cable',
        label: 'Test Cable 50mm²',
        R12_ohm_per_km: 0.6,
        X12_ohm_per_km: 0.08,
        R0_ohm_per_km: 0.8,
        X0_ohm_per_km: 0.12,
        matiere: 'CUIVRE',
        posesPermises: ['SOUTERRAIN'],
        maxCurrent_A: 150
      }
    ];
  });

  it('should prevent SRG2 and classical regulator interference', async () => {
    // Phase 3 - Test unitaire pour vérifier la non-interférence
    const simulationEquipment: SimulationEquipment = {
      srg2: {
        nodeId: 'srg2-node',
        enabled: true,
        networkType: '230V',
        maxPowerInjection_kVA: 85,
        maxPowerConsumption_kVA: 100
      },
      regulators: [
        {
          id: 'classical-reg',
          nodeId: 'srg2-node', // CONFLIT INTENTIONNEL - même nœud que SRG2
          type: '230V_77kVA',
          targetVoltage_V: 235,
          maxPower_kVA: 77,
          enabled: true
        },
        {
          id: 'other-classical-reg',
          nodeId: 'classical-node', // Nœud différent - OK
          type: '230V_77kVA',
          targetVoltage_V: 240,
          maxPower_kVA: 77,
          enabled: true
        }
      ],
      neutralCompensators: [],
      cableUpgrades: []
    };

    // Mock console methods to capture warnings
    const consoleWarnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message: string) => {
      consoleWarnings.push(message);
    };

    try {
      const result = await calculator.calculateWithSimulation(
        mockProject as Project,
        'PRÉLÈVEMENT',
        simulationEquipment
      );

      // Vérifications
      
      // 1. Vérifier que les avertissements de conflit ont été émis
      const interferenceWarnings = consoleWarnings.filter(w => w.includes('INTERFERENCE-WARNING'));
      expect(interferenceWarnings.length).toBeGreaterThan(0);
      
      // 2. Vérifier que le résultat SRG2 est présent
      expect((result as any).srg2Result).toBeDefined();
      expect((result as any).srg2Result.nodeId).toBe('srg2-node');
      
      console.log('✅ Test passed: SRG2 interference prevention working correctly');
      
    } finally {
      // Restore console.warn
      console.warn = originalWarn;
    }
  });

  it('should allow separate SRG2 and classical regulators on different nodes', async () => {
    const simulationEquipment: SimulationEquipment = {
      srg2: {
        nodeId: 'srg2-node',
        enabled: true,
        networkType: '230V',
        maxPowerInjection_kVA: 85,
        maxPowerConsumption_kVA: 100
      },
      regulators: [
        {
          id: 'classical-reg',
          nodeId: 'classical-node', // Nœud DIFFÉRENT du SRG2
          type: '230V_77kVA',
          targetVoltage_V: 240,
          maxPower_kVA: 77,
          enabled: true
        }
      ],
      neutralCompensators: [],
      cableUpgrades: []
    };

    const result = await calculator.calculateWithSimulation(
      mockProject as Project,
      'PRÉLÈVEMENT',
      simulationEquipment
    );

    // Vérifications
    expect((result as any).srg2Result).toBeDefined();
    expect((result as any).srg2Result.nodeId).toBe('srg2-node');
    
    console.log('✅ Test passed: SRG2 and classical regulators can coexist on different nodes');
  });
});