// SRG2 FIX: Tests unitaires pour vérifier les corrections des bugs SRG2
import { SimulationCalculator } from '../simulationCalculator';
import { Node, Cable, CableType, Project, VoltageRegulator, CalculationResult } from '../../types/network';

describe('SRG2 Corrections Tests', () => {
  let calculator: SimulationCalculator;

  beforeEach(() => {
    calculator = new SimulationCalculator();
  });

  // SRG2 FIX: Test regulation par phase indépendante (SRG2-400V)
  test('should regulate each phase independently for SRG2-400V', () => {
    const mockNodes: Node[] = [
      {
        id: 'source',
        name: 'Source',
        lat: 0, lng: 0,
        connectionType: 'TÉTRA_3P+N_230_400V',
        clients: [],
        productions: [],
        isSource: true
      },
      {
        id: 'reg_node',
        name: 'SRG2 Node',
        lat: 100, lng: 0,
        connectionType: 'TÉTRA_3P+N_230_400V',
        clients: [{
          id: 'load1',
          label: 'Test Load',
          S_kVA: 20
        }],
        productions: [],
        isVoltageRegulator: true
      }
    ];

    const mockCables: Cable[] = [
      {
        id: 'cable1',
        name: 'Test Cable',
        nodeAId: 'source',
        nodeBId: 'reg_node',
        typeId: 'test_type',
        pose: 'AÉRIEN',
        length_m: 200,
        coordinates: []
      }
    ];

    const mockCableTypes: CableType[] = [
      {
        id: 'test_type',
        label: 'Test Type',
        R12_ohm_per_km: 0.5,
        X12_ohm_per_km: 0.3,
        R0_ohm_per_km: 0.8,
        X0_ohm_per_km: 0.5,
        matiere: 'CUIVRE',
        posesPermises: ['AÉRIEN', 'SOUTERRAIN'],
        maxCurrent_A: 100
      }
    ];

    const mockRegulator: VoltageRegulator = {
      id: 'srg2_reg',
      nodeId: 'reg_node',
      type: '400V_44kVA',
      targetVoltage_V: 400,
      maxPower_kVA: 77,
      enabled: true
    };

    const mockProject: Project = {
      id: 'test_project',
      name: 'Test Project',
      voltageSystem: 'TÉTRAPHASÉ_400V',
      cosPhi: 0.9,
      foisonnementCharges: 100,
      foisonnementProductions: 100,
      defaultChargeKVA: 5,
      defaultProductionKVA: 5,
      nodes: mockNodes,
      cables: mockCables,
      cableTypes: mockCableTypes,
      transformerConfig: { 
        rating: '630kVA',
        nominalPower_kVA: 630,
        nominalVoltage_V: 400, 
        shortCircuitVoltage_percent: 4,
        cosPhi: 0.9
      },
      desequilibrePourcent: 15, // Déséquilibre pour tester régulation par phase
      manualPhaseDistribution: undefined,
      forcedModeConfig: undefined
    };

    // Simulation avec tensions déséquilibrées
    const mockBaseResult: CalculationResult = {
      scenario: 'MIXTE',
      cables: mockCables,
      totalLoads_kVA: 20,
      totalProductions_kVA: 0,
      globalLosses_kW: 0.5,
      maxVoltageDropPercent: 3.2,
      compliance: 'normal',
      nodeMetricsPerPhase: [
        {
          nodeId: 'reg_node',
          voltagesPerPhase: { A: 420, B: 385, C: 405 }, // Tensions déséquilibrées
          voltageDropsPerPhase: { A: 10, B: 25, C: 15 }
        }
      ]
    };

    const result = calculator.applyAllVoltageRegulators(
      mockNodes,
      mockCables,
      [mockRegulator],
      mockBaseResult,
      mockCableTypes,
      mockProject
    );

    // SRG2 FIX: Vérifier que chaque phase régule indépendamment
    const regulatedNode = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'reg_node');
    expect(regulatedNode).toBeDefined();
    
    if (regulatedNode) {
      // Phase A était haute (420V) → devrait être réduite
      expect(regulatedNode.voltagesPerPhase.A).toBeLessThan(420);
      // Phase B était basse (385V) → devrait être augmentée  
      expect(regulatedNode.voltagesPerPhase.B).toBeGreaterThan(385);
      // Phase C proche nominal → changement minimal
      expect(Math.abs(regulatedNode.voltagesPerPhase.C - 405)).toBeLessThan(10);
    }
  });

  // SRG2 FIX: Test hystérésis et temporisation
  test('should apply hysteresis and time delays for SRG2 activation', () => {
    const mockRegulator: VoltageRegulator = {
      id: 'srg2_reg',
      nodeId: 'test_node',
      type: '230V_77kVA',
      targetVoltage_V: 230,
      maxPower_kVA: 44,
      enabled: true
    };

    // Cas 1: Tension juste au-dessus du seuil sans hystérésis → Ne doit PAS activer
    const highVoltageResult: CalculationResult = {
      scenario: 'MIXTE',
      cables: [],
      totalLoads_kVA: 10,
      totalProductions_kVA: 0,
      globalLosses_kW: 0.2,
      maxVoltageDropPercent: 2.5,
      compliance: 'warning',
      nodeMetricsPerPhase: [
        {
          nodeId: 'test_node',
          voltagesPerPhase: { A: 247, B: 247, C: 247 }, // Juste > 246V mais < 248V (hystérésis)
          voltageDropsPerPhase: { A: 5, B: 5, C: 5 }
        }
      ]
    };

    // SRG2 FIX: Avec hystérésis, 247V ne devrait pas déclencher (< 246+2=248V)
    expect(() => {
      calculator.applyAllVoltageRegulators(
        [{
          id: 'test_node',
          name: 'Test',
          lat: 0, lng: 0,
          connectionType: 'MONO_230V_PN',
          clients: [],
          productions: []
        }],
        [],
        [mockRegulator],
        highVoltageResult,
        [],
        {
          transformerConfig: { nominalVoltage_V: 230 }
        } as Project
      );
    }).not.toThrow();

    // Cas 2: Tension bien au-dessus avec hystérésis → Doit rejeter
    const tooHighVoltageResult: CalculationResult = {
      scenario: 'MIXTE',
      cables: [],
      totalLoads_kVA: 10,
      totalProductions_kVA: 0,
      globalLosses_kW: 0.2,
      maxVoltageDropPercent: 2.5,
      compliance: 'critical',
      nodeMetricsPerPhase: [
        {
          nodeId: 'test_node',
          voltagesPerPhase: { A: 250, B: 250, C: 250 }, // > 246+2=248V
          voltageDropsPerPhase: { A: 8, B: 8, C: 8 }
        }
      ]
    };

    // SRG2 FIX: 250V devrait être rejeté avec message d'avertissement
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    
    calculator.applyAllVoltageRegulators(
      [{
        id: 'test_node',
        name: 'Test',
        lat: 0, lng: 0,
        connectionType: 'MONO_230V_PN',
        clients: [],
        productions: []
      }],
      [],
      [mockRegulator],
      tooHighVoltageResult,
      [],
      {
        transformerConfig: { nominalVoltage_V: 230 }
      } as Project
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Max voltage 250.0V > 248V (with hysteresis) - Cannot regulate, SKIPPED')
    );

    consoleSpy.mockRestore();
  });

  // SRG2 FIX: Test calcul d'impédances sur tout le chemin
  test('should calculate impedances along entire path from source to node', () => {
    const mockNodes: Node[] = [
      { id: 'source', name: 'Source', lat: 0, lng: 0, connectionType: 'TÉTRA_3P+N_230_400V', clients: [], productions: [], isSource: true },
      { id: 'node1', name: 'Node 1', lat: 50, lng: 0, connectionType: 'TÉTRA_3P+N_230_400V', clients: [], productions: [] },
      { id: 'compensator', name: 'Compensator', lat: 100, lng: 0, connectionType: 'TÉTRA_3P+N_230_400V', clients: [], productions: [] }
    ];

    const mockCables: Cable[] = [
      {
        id: 'cable1',
        name: 'Cable 1',
        nodeAId: 'source',
        nodeBId: 'node1',
        typeId: 'type1',
        pose: 'AÉRIEN',
        length_m: 100,
        coordinates: []
      },
      {
        id: 'cable2', 
        name: 'Cable 2',
        nodeAId: 'node1',
        nodeBId: 'compensator',
        typeId: 'type2',
        pose: 'SOUTERRAIN',
        length_m: 150,
        coordinates: []
      }
    ];

    const mockCableTypes: CableType[] = [
      {
        id: 'type1',
        label: 'Type 1',
        R12_ohm_per_km: 1.0,
        X12_ohm_per_km: 0.5,
        R0_ohm_per_km: 1.5,
        X0_ohm_per_km: 0.8,
        matiere: 'CUIVRE',
        posesPermises: ['AÉRIEN', 'SOUTERRAIN'],
        maxCurrent_A: 100
      },
      {
        id: 'type2',
        label: 'Type 2', 
        R12_ohm_per_km: 0.8,
        X12_ohm_per_km: 0.4,
        R0_ohm_per_km: 1.2,
        X0_ohm_per_km: 0.6,
        matiere: 'ALUMINIUM',
        posesPermises: ['SOUTERRAIN'],
        maxCurrent_A: 80
      }
    ];

    // SRG2 FIX: Le calcul d'impédances devrait sommer les deux câbles
    // Cable 1: 0.1km * sqrt(1.0² + 0.5²) = 0.1 * 1.118 = 0.112Ω
    // Cable 2: 0.15km * sqrt(0.8² + 0.4²) = 0.15 * 0.894 = 0.134Ω  
    // Total Zph ≈ 0.246Ω

    const result = (calculator as any).calculateNetworkImpedances(
      'compensator',
      mockNodes,
      mockCables,
      mockCableTypes
    );

    expect(result.Zph).toBeCloseTo(0.246, 2);
    expect(result.Zn).toBeGreaterThan(0.2); // Impédance neutre également sommée
  });
});