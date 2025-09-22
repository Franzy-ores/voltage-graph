import { SimulationCalculator } from '../simulationCalculator';
import { SRG2Regulator } from '../SRG2Regulator';
import { Project, CalculationScenario, SimulationEquipment, Node, Cable, CableType, TransformerConfig, ConnectionType } from '@/types/network';

/**
 * Test unitaire pour vérifier qu'un seul calcul SRG2 a lieu par simulation
 */
describe('SRG2 Single Calculation Test', () => {
  let calculator: SimulationCalculator;
  let srg2ApplySpy: jest.SpyInstance;

  beforeEach(() => {
    calculator = new SimulationCalculator();
    srg2ApplySpy = jest.spyOn(SRG2Regulator.prototype, 'apply');
  });

  afterEach(() => {
    srg2ApplySpy.mockRestore();
  });

  const createTestProject = (): Project => {
    const nodes: Node[] = [
      {
        id: 'node-source',
        name: 'Source',
        lat: 0,
        lng: 0,
        connectionType: 'TÉTRA_3P+N_230_400V' as ConnectionType,
        clients: [],
        productions: [],
        isSource: true,
        tensionCible: 230
      },
      {
        id: 'node-srg2',
        name: 'Node SRG2',
        lat: 0.001,
        lng: 0,
        connectionType: 'TÉTRA_3P+N_230_400V' as ConnectionType,
        clients: [{ id: 'charge-1', label: 'Test Charge', S_kVA: 10 }],
        productions: [],
        isSource: false,
        tensionCible: 400
      }
    ];

    const cables: Cable[] = [
      {
        id: 'cable-1',
        name: 'Test Cable Connection',
        nodeAId: 'node-source',
        nodeBId: 'node-srg2',
        typeId: 'cable-type-1',
        pose: 'SOUTERRAIN',
        coordinates: [
          { lat: 0, lng: 0 },
          { lat: 0.001, lng: 0 }
        ],
        length_m: 100
      }
    ];

    const cableTypes: CableType[] = [
      {
        id: 'cable-type-1',
        label: 'Test Cable Type',
        R12_ohm_per_km: 0.32,
        X12_ohm_per_km: 0.08,
        R0_ohm_per_km: 1.28,
        X0_ohm_per_km: 0.32,
        matiere: 'CUIVRE',
        posesPermises: ['SOUTERRAIN'],
        maxCurrent_A: 100
      }
    ];

    const transformerConfig: TransformerConfig = {
      rating: '250kVA',
      nominalPower_kVA: 250,
      nominalVoltage_V: 400,
      shortCircuitVoltage_percent: 4,
      cosPhi: 0.95
    };

    return {
      id: 'test-project',
      name: 'Test Project',
      voltageSystem: 'TÉTRAPHASÉ_400V',
      cosPhi: 0.95,
      foisonnementCharges: 100,
      foisonnementProductions: 100,
      defaultChargeKVA: 5,
      defaultProductionKVA: 5,
      transformerConfig,
      loadModel: 'polyphase_equilibre',
      desequilibrePourcent: 0,
      nodes,
      cables,
      cableTypes
    };
  };

  test('SRG2 is applied exactly once per simulation', () => {
    const project = createTestProject();
    const scenario: CalculationScenario = 'PRÉLÈVEMENT';

    const equipment: SimulationEquipment = {
      srg2: {
        nodeId: 'node-srg2',
        enabled: true
      },
      neutralCompensators: [],
      cableUpgrades: []
    };

    // Execute simulation
    const result = calculator.calculateWithSimulation(project, scenario, equipment);

    // Verify SRG2 was applied exactly once
    expect(srg2ApplySpy).toHaveBeenCalledTimes(1);
    expect(srg2ApplySpy).toHaveBeenCalledWith(
      equipment.srg2,
      expect.objectContaining({ id: 'node-srg2' }),
      project,
      expect.any(Object) // actualVoltages object
    );

    // Verify SRG2 result exists
    expect(result.srg2Result).toBeDefined();
    expect(result.srg2Result?.nodeId).toBe('node-srg2');

    // Verify no duplicate srg2Result in sub-results
    const resultKeys = Object.keys(result);
    const srg2Keys = resultKeys.filter(key => key.includes('srg2') || key.includes('SRG2'));
    expect(srg2Keys).toHaveLength(1);
    expect(srg2Keys[0]).toBe('srg2Result');
  });

  test('SRG2 disabled does not trigger calculation', () => {
    const project = createTestProject();
    const scenario: CalculationScenario = 'PRÉLÈVEMENT';

    const equipment: SimulationEquipment = {
      srg2: {
        nodeId: 'node-srg2',
        enabled: false // Disabled
      },
      neutralCompensators: [],
      cableUpgrades: []
    };

    // Execute simulation
    const result = calculator.calculateWithSimulation(project, scenario, equipment);

    // Verify SRG2 was not called
    expect(srg2ApplySpy).not.toHaveBeenCalled();

    // Verify no SRG2 result
    expect(result.srg2Result).toBeUndefined();
  });

  test('Missing SRG2 node does not break simulation', () => {
    const project = createTestProject();
    const scenario: CalculationScenario = 'PRÉLÈVEMENT';

    const equipment: SimulationEquipment = {
      srg2: {
        nodeId: 'non-existent-node',
        enabled: true
      },
      neutralCompensators: [],
      cableUpgrades: []
    };

    // Execute simulation
    const result = calculator.calculateWithSimulation(project, scenario, equipment);

    // Verify SRG2 was not called due to missing node
    expect(srg2ApplySpy).not.toHaveBeenCalled();

    // Verify no SRG2 result
    expect(result.srg2Result).toBeUndefined();

    // Simulation should still complete successfully
    expect(result.isSimulation).toBe(true);
    expect(result.convergenceStatus).toBe('converged');
  });
});