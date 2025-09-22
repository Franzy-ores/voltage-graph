import { SimulationCalculator } from '../simulationCalculator';
import { SRG2Regulator } from '../SRG2Regulator';
import { Node, Cable, CableType, Project, SimulationEquipment, SRG2Config } from '@/types/network';

describe('SRG2 Regulator Integration', () => {
  let calculator: SimulationCalculator;
  let srg2Regulator: SRG2Regulator;

  beforeEach(() => {
    calculator = new SimulationCalculator(0.95);
    srg2Regulator = new SRG2Regulator();
  });

  const createTestProject = (): Project => {
    const nodes: Node[] = [
      {
        id: 'source',
        name: 'Source Transformer',
        lat: 0,
        lng: 0,
        connectionType: 'TÉTRA_3P+N_230_400V',
        clients: [],
        productions: [],
        isSource: true,
        tensionCible: 400
      },
      {
        id: 'srg2_node',
        name: 'SRG2 Regulation Point',
        lat: 0.001,
        lng: 0.001,
        connectionType: 'TÉTRA_3P+N_230_400V',
        clients: [],
        productions: [],
        tensionCible: 415 // High voltage to trigger LO regulation
      },
      {
        id: 'load_node',
        name: 'Load Node',
        lat: 0.002,
        lng: 0.002,
        connectionType: 'TÉTRA_3P+N_230_400V',
        clients: [{ id: 'client1', label: 'Test Load', S_kVA: 50 }],
        productions: []
      }
    ];

    const cableTypes: CableType[] = [
      {
        id: 'test_cable',
        label: 'Test Cable 70mm²',
        R12_ohm_per_km: 0.5,
        X12_ohm_per_km: 0.1,
        R0_ohm_per_km: 1.0,
        X0_ohm_per_km: 0.2,
        matiere: 'ALUMINIUM',
        posesPermises: ['SOUTERRAIN']
      }
    ];

    const cables: Cable[] = [
      {
        id: 'cable1',
        name: 'Source to SRG2',
        nodeAId: 'source',
        nodeBId: 'srg2_node',
        typeId: 'test_cable',
        pose: 'SOUTERRAIN',
        coordinates: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }],
        length_m: 100
      },
      {
        id: 'cable2',
        name: 'SRG2 to Load',
        nodeAId: 'srg2_node',
        nodeBId: 'load_node',
        typeId: 'test_cable',
        pose: 'SOUTERRAIN',
        coordinates: [{ lat: 0.001, lng: 0.001 }, { lat: 0.002, lng: 0.002 }],
        length_m: 200
      }
    ];

    return {
      id: 'test-srg2-project',
      name: 'SRG2 Integration Test',
      voltageSystem: '400V' as any,
      cosPhi: 0.95,
      foisonnementCharges: 100,
      foisonnementProductions: 100,
      tensionSource: 400,
      loadModel: 'polyphase_equilibre',
      desequilibrePourcent: 0,
      defaultChargeKVA: 5,
      defaultProductionKVA: 10,
      nodes,
      cables,
      cableTypes,
      transformerConfig: {
        rating: '400kVA',
        nominalPower_kVA: 400,
        nominalVoltage_V: 400,
        shortCircuitVoltage_percent: 4,
        cosPhi: 0.95,
        xOverR: 3
      }
    } as Project;
  };

  const createSRG2Config = (): SRG2Config => ({
    nodeId: 'srg2_node',
    enabled: true,
    networkType: '400V',
    maxPowerInjection_kVA: 85,
    maxPowerConsumption_kVA: 100
  });

  test('should apply SRG2 regulation for high voltage', () => {
    const project = createTestProject();
    const srg2Config = createSRG2Config();
    
    const targetNode = project.nodes.find(n => n.id === 'srg2_node')!;
    targetNode.tensionCible = 420; // Very high voltage to trigger LO2

    const result = srg2Regulator.apply(srg2Config, targetNode, project);

    expect(result.isActive).toBe(true);
    expect(result.state).toBe('LO2');
    expect(result.ratio).toBe(0.93);
    expect(result.regulatedVoltage).toBeCloseTo(420 * 0.93, 1);
    expect(result.originalVoltage).toBe(420);
  });

  test('should apply SRG2 regulation for low voltage', () => {
    const project = createTestProject();
    const srg2Config = createSRG2Config();
    
    const targetNode = project.nodes.find(n => n.id === 'srg2_node')!;
    targetNode.tensionCible = 380; // Low voltage to trigger BO2

    const result = srg2Regulator.apply(srg2Config, targetNode, project);

    expect(result.isActive).toBe(true);
    expect(result.state).toBe('BO2');
    expect(result.ratio).toBe(1.07);
    expect(result.regulatedVoltage).toBeCloseTo(380 * 1.07, 1);
  });

  test('should not activate SRG2 for normal voltage', () => {
    const project = createTestProject();
    const srg2Config = createSRG2Config();
    
    const targetNode = project.nodes.find(n => n.id === 'srg2_node')!;
    targetNode.tensionCible = 400; // Normal voltage

    const result = srg2Regulator.apply(srg2Config, targetNode, project);

    expect(result.isActive).toBe(true);
    expect(result.state).toBe('BYP');
    expect(result.ratio).toBe(1.0);
    expect(result.regulatedVoltage).toBe(400);
  });

  test('should respect power limits', () => {
    const project = createTestProject();
    const srg2Config = createSRG2Config();
    srg2Config.maxPowerConsumption_kVA = 10; // Very low limit
    
    const targetNode = project.nodes.find(n => n.id === 'srg2_node')!;
    targetNode.tensionCible = 420;
    
    // Add high power load
    const loadNode = project.nodes.find(n => n.id === 'load_node')!;
    loadNode.clients = [{ id: 'big_load', label: 'Big Load', S_kVA: 80 }];

    const result = srg2Regulator.apply(srg2Config, targetNode, project);

    expect(result.isActive).toBe(false);
    expect(result.limitReason).toContain('exceeds limit');
  });

  test('should integrate with SimulationCalculator', () => {
    const project = createTestProject();
    const simulationEquipment: SimulationEquipment = {
      regulators: [],
      neutralCompensators: [],
      cableUpgrades: [],
      srg2: createSRG2Config()
    };

    // Set high voltage to trigger regulation
    const srg2Node = project.nodes.find(n => n.id === 'srg2_node')!;
    srg2Node.tensionCible = 420;

    const result = calculator.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      simulationEquipment
    );

    expect(result.isSimulation).toBe(true);
    expect(result.srg2Result).toBeDefined();
    expect(result.srg2Result!.isActive).toBe(true);
    expect(result.srg2Result!.state).toBe('LO2');
    expect(result.srg2Result!.ratio).toBe(0.93);
  });

  test('should apply hysteresis correctly', () => {
    const project = createTestProject();
    const srg2Config = createSRG2Config();
    const targetNode = project.nodes.find(n => n.id === 'srg2_node')!;

    // First application at high voltage
    targetNode.tensionCible = 420;
    const result1 = srg2Regulator.apply(srg2Config, targetNode, project, 1000);
    expect(result1.state).toBe('LO2');

    // Second application at slightly lower voltage (within hysteresis)
    targetNode.tensionCible = 418;
    const result2 = srg2Regulator.apply(srg2Config, targetNode, project, 2000);
    expect(result2.state).toBe('WAIT'); // Should wait due to hysteresis

    // Third application after delay
    const result3 = srg2Regulator.apply(srg2Config, targetNode, project, 10000);
    expect(result3.state).toBe('LO2'); // Should still be LO2 due to hysteresis
  });

  test('should handle 230V network type', () => {
    const project = createTestProject();
    project.voltageSystem = '230V' as any;
    
    const srg2Config: SRG2Config = {
      nodeId: 'srg2_node',
      enabled: true,
      networkType: '230V',
      maxPowerInjection_kVA: 85,
      maxPowerConsumption_kVA: 100
    };

    const targetNode = project.nodes.find(n => n.id === 'srg2_node')!;
    targetNode.tensionCible = 250; // High voltage for 230V system

    const result = srg2Regulator.apply(srg2Config, targetNode, project);

    expect(result.isActive).toBe(true);
    expect(result.state).toBe('LO2');
    expect(result.ratio).toBe(0.93);
    expect(result.regulatedVoltage).toBeCloseTo(250 * 0.93, 1);
  });

  test('should store SRG2 state in node after application', () => {
    const project = createTestProject();
    const srg2Config = createSRG2Config();
    const targetNode = project.nodes.find(n => n.id === 'srg2_node')!;
    targetNode.tensionCible = 420;

    const result = srg2Regulator.apply(srg2Config, targetNode, project);
    const modifiedNodes = srg2Regulator.applyRegulationToNetwork(result, project.nodes, project.cables);

    const regulatedNode = modifiedNodes.find(n => n.id === 'srg2_node');
    expect(regulatedNode?.tensionCible).toBeCloseTo(420 * 0.93, 1);
  });
});