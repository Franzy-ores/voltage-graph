// SRG2 FIX: Tests unitaires pour vérifier les corrections des bugs SRG2
import { SimulationCalculator } from '../simulationCalculator';
import { Node, Cable, CableType, Project, VoltageRegulator } from '../../types/network';
import { CalculationResult } from '../electricalCalculations';

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
        x: 0, y: 0,
        clients: [],
        productions: [],
        isSource: true
      },
      {
        id: 'reg_node',
        name: 'SRG2 Node',
        x: 100, y: 0,
        clients: [{
          id: 'load1',
          name: 'Test Load',
          power_kW: 20,
          connectionType: 'TRIPHASÉ_400V'
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
        length_m: 200,
        coordinates: []
      }
    ];

    const mockCableTypes: CableType[] = [
      {
        id: 'test_type',
        name: 'Test Type',
        R12_ohm_per_km: 0.5,
        X12_ohm_per_km: 0.3,
        R0_ohm_per_km: 0.8,
        X0_ohm_per_km: 0.5,
        Imax_A: 100
      }
    ];

    const mockRegulator: VoltageRegulator = {
      id: 'srg2_reg',
      nodeId: 'reg_node',
      type: 'SRG2-400V',
      targetVoltage_V: 400,
      maxPower_kVA: 77,
      enabled: true
    };

    const mockProject: Project = {
      id: 'test_project',
      name: 'Test Project',
      nodes: mockNodes,
      cables: mockCables,
      cableTypes: mockCableTypes,
      transformerConfig: { nominalVoltage_V: 400, power_kVA: 630, phases: 3 } as any,
      desequilibrePourcent: 15, // Déséquilibre pour tester régulation par phase
      manualPhaseDistribution: undefined,
      forcedModeConfig: undefined
    };

    // Simulation avec tensions déséquilibrées
    const mockBaseResult: CalculationResult = {
      nodeMetricsPerPhase: [
        {
          nodeId: 'reg_node',
          voltagesPerPhase: { A: 420, B: 385, C: 405 }, // Tensions déséquilibrées
          currentsPerPhase: { A: 10, B: 15, C: 12 },
          current_A: 12.3,
          voltage_V: 403.3
        }
      ],
      cableMetrics: []
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
      type: 'SRG2-230V',
      targetVoltage_V: 230,
      maxPower_kVA: 44,
      enabled: true
    };

    // Cas 1: Tension juste au-dessus du seuil sans hystérésis → Ne doit PAS activer
    const highVoltageResult: CalculationResult = {
      nodeMetricsPerPhase: [
        {
          nodeId: 'test_node',
          voltagesPerPhase: { A: 247, B: 247, C: 247 }, // Juste > 246V mais < 248V (hystérésis)
          currentsPerPhase: { A: 10, B: 10, C: 10 },
          current_A: 10,
          voltage_V: 247
        }
      ],
      cableMetrics: []
    };

    // SRG2 FIX: Avec hystérésis, 247V ne devrait pas déclencher (< 246+2=248V)
    expect(() => {
      calculator.applyAllVoltageRegulators(
        [{
          id: 'test_node',
          name: 'Test',
          x: 0, y: 0,
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
      nodeMetricsPerPhase: [
        {
          nodeId: 'test_node',
          voltagesPerPhase: { A: 250, B: 250, C: 250 }, // > 246+2=248V
          currentsPerPhase: { A: 10, B: 10, C: 10 },
          current_A: 10,
          voltage_V: 250
        }
      ],
      cableMetrics: []
    };

    // SRG2 FIX: 250V devrait être rejeté avec message d'avertissement
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    
    calculator.applyAllVoltageRegulators(
      [{
        id: 'test_node',
        name: 'Test',
        x: 0, y: 0,
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
      { id: 'source', name: 'Source', x: 0, y: 0, clients: [], productions: [], isSource: true },
      { id: 'node1', name: 'Node 1', x: 50, y: 0, clients: [], productions: [] },
      { id: 'compensator', name: 'Compensator', x: 100, y: 0, clients: [], productions: [] }
    ];

    const mockCables: Cable[] = [
      {
        id: 'cable1',
        name: 'Cable 1',
        nodeAId: 'source',
        nodeBId: 'node1',
        typeId: 'type1',
        length_m: 100,
        coordinates: []
      },
      {
        id: 'cable2', 
        name: 'Cable 2',
        nodeAId: 'node1',
        nodeBId: 'compensator',
        typeId: 'type2',
        length_m: 150,
        coordinates: []
      }
    ];

    const mockCableTypes: CableType[] = [
      {
        id: 'type1',
        name: 'Type 1',
        R12_ohm_per_km: 1.0,
        X12_ohm_per_km: 0.5,
        R0_ohm_per_km: 1.5,
        X0_ohm_per_km: 0.8,
        Imax_A: 100
      },
      {
        id: 'type2',
        name: 'Type 2', 
        R12_ohm_per_km: 0.8,
        X12_ohm_per_km: 0.4,
        R0_ohm_per_km: 1.2,
        X0_ohm_per_km: 0.6,
        Imax_A: 80
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