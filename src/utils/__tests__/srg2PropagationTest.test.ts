import { SimulationCalculator } from '../simulationCalculator';
import { SRG2Regulator } from '../SRG2Regulator';
import { Project, CalculationScenario, SimulationEquipment, Node, Cable, CableType, TransformerConfig, ConnectionType } from '@/types/network';

/**
 * Tests pour vérifier la propagation de tension du régulateur SRG2
 */
describe('SRG2 Voltage Propagation Tests', () => {
  let calculator: SimulationCalculator;

  beforeEach(() => {
    calculator = new SimulationCalculator();
  });

  const createLinearNetwork = (): Project => {
    // Construction d'un mini-réseau (A → B → C)
    const nodes: Node[] = [
      {
        id: 'A',
        name: 'Source Node',
        lat: 0,
        lng: 0,
        connectionType: 'TÉTRA_3P+N_230_400V' as ConnectionType,
        clients: [],
        productions: [],
        isSource: true,
        tensionCible: 230
      },
      {
        id: 'B',
        name: 'Intermediate Node',
        lat: 0.001,
        lng: 0,
        connectionType: 'TÉTRA_3P+N_230_400V' as ConnectionType,
        clients: [{ id: 'charge-B', label: 'Load B', S_kVA: 5 }],
        productions: [],
        tensionCible: 230
      },
      {
        id: 'C',
        name: 'End Node',
        lat: 0.002,
        lng: 0,
        connectionType: 'TÉTRA_3P+N_230_400V' as ConnectionType,
        clients: [{ id: 'charge-C', label: 'Load C', S_kVA: 3 }],
        productions: [],
        tensionCible: 230
      }
    ];

    const cables: Cable[] = [
      {
        id: 'c1',
        name: 'Cable A-B',
        nodeAId: 'A',
        nodeBId: 'B',
        typeId: 'type1',
        pose: 'SOUTERRAIN',
        coordinates: [
          { lat: 0, lng: 0 },
          { lat: 0.001, lng: 0 }
        ],
        length_m: 100
      },
      {
        id: 'c2',
        name: 'Cable B-C',
        nodeAId: 'B',
        nodeBId: 'C',
        typeId: 'type1',
        pose: 'SOUTERRAIN',
        coordinates: [
          { lat: 0.001, lng: 0 },
          { lat: 0.002, lng: 0 }
        ],
        length_m: 100
      }
    ];

    const cableTypes: CableType[] = [
      {
        id: 'type1',
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
      nominalVoltage_V: 230,
      shortCircuitVoltage_percent: 4,
      cosPhi: 0.95
    };

    return {
      id: 'linear-network',
      name: 'Linear Test Network',
      voltageSystem: 'TRIPHASÉ_230V',
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

  test('SRG2 propagates voltage downstream in linear network', () => {
    const project = createLinearNetwork();
    const scenario: CalculationScenario = 'PRÉLÈVEMENT';

    const equipment: SimulationEquipment = {
      srg2: {
        nodeId: 'A',
        enabled: true,
        networkType: '230V',
        maxPowerInjection_kVA: 500,
        maxPowerConsumption_kVA: 500
      },
      neutralCompensators: [],
      cableUpgrades: []
    };

    const result = calculator.calculateWithSimulation(project, scenario, equipment);

    // Vérifier que le SRG2 est actif
    expect(result.srg2Result).toBeDefined();
    expect(result.srg2Result?.isActive).toBe(true);
    expect(result.srg2Result?.nodeId).toBe('A');

    // Vérifier la propagation des tensions - utiliser les nœuds du projet qui ont été modifiés
    const nodeA = project.nodes.find(n => n.id === 'A');
    const nodeB = project.nodes.find(n => n.id === 'B');
    const nodeC = project.nodes.find(n => n.id === 'C');

    // Tous les nœuds devraient avoir les propriétés SRG2 appliquées
    expect(nodeA?.srg2Applied).toBe(true);
    expect(nodeB?.srg2Applied).toBe(true);
    expect(nodeC?.srg2Applied).toBe(true);

    // Vérifier que le même ratio est appliqué
    const expectedRatio = result.srg2Result?.ratio || 1.0;
    expect(nodeA?.srg2Ratio).toBeCloseTo(expectedRatio, 3);
    expect(nodeB?.srg2Ratio).toBeCloseTo(expectedRatio, 3);
    expect(nodeC?.srg2Ratio).toBeCloseTo(expectedRatio, 3);

    // Vérifier que les tensions sont cohérentes avec le ratio
    expect(nodeA?.tensionCible).toBeCloseTo(230 * expectedRatio, 1);
    expect(nodeB?.tensionCible).toBeCloseTo(230 * expectedRatio, 1);
    expect(nodeC?.tensionCible).toBeCloseTo(230 * expectedRatio, 1);
  });

  test('SRG2 is applied exactly once during propagation', () => {
    const project = createLinearNetwork();
    const scenario: CalculationScenario = 'PRÉLÈVEMENT';
    
    const srg2ApplySpy = jest.spyOn(SRG2Regulator.prototype, 'apply');
    const srg2NetworkSpy = jest.spyOn(SRG2Regulator.prototype, 'applyRegulationToNetwork');

    const equipment: SimulationEquipment = {
      srg2: {
        nodeId: 'A',
        enabled: true,
        networkType: '230V',
        maxPowerInjection_kVA: 500,
        maxPowerConsumption_kVA: 500
      },
      neutralCompensators: [],
      cableUpgrades: []
    };

    const result = calculator.calculateWithSimulation(project, scenario, equipment);

    // Vérifier que SRG2.apply n'est appelé qu'une fois
    expect(srg2ApplySpy).toHaveBeenCalledTimes(1);
    
    // Vérifier que applyRegulationToNetwork n'est appelé qu'une fois
    expect(srg2NetworkSpy).toHaveBeenCalledTimes(1);
    expect(srg2NetworkSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Array),
      expect.any(Array),
      'downstream'
    );

    // Vérifier qu'il n'y a qu'un seul srg2Result
    expect(result.srg2Result).toBeDefined();
    const resultKeys = Object.keys(result);
    const srg2Keys = resultKeys.filter(key => key.toLowerCase().includes('srg2'));
    expect(srg2Keys).toHaveLength(1);

    srg2ApplySpy.mockRestore();
    srg2NetworkSpy.mockRestore();
  });

  test('SRG2 disabled does not propagate voltage', () => {
    const project = createLinearNetwork();
    const scenario: CalculationScenario = 'PRÉLÈVEMENT';

    const equipment: SimulationEquipment = {
      srg2: {
        nodeId: 'A',
        enabled: false, // Disabled
        networkType: '230V',
        maxPowerInjection_kVA: 500,
        maxPowerConsumption_kVA: 500
      },
      neutralCompensators: [],
      cableUpgrades: []
    };

    const result = calculator.calculateWithSimulation(project, scenario, equipment);

    // Vérifier qu'aucun SRG2 n'est appliqué
    expect(result.srg2Result).toBeUndefined();

    // Vérifier qu'aucun nœud n'a les propriétés SRG2
    project.nodes.forEach(node => {
      expect(node.srg2Applied).toBeFalsy();
      expect(node.srg2Ratio).toBeUndefined();
      expect(node.srg2State).toBeUndefined();
    });
  });

  test('Node initialization ensures tensionCible is set', () => {
    const project = createLinearNetwork();
    
    // Supprimer tensionCible des nœuds pour tester l'initialisation
    project.nodes.forEach(node => {
      delete node.tensionCible;
    });

    const scenario: CalculationScenario = 'PRÉLÈVEMENT';
    const equipment: SimulationEquipment = {
      srg2: {
        nodeId: 'A',
        enabled: true,
        networkType: '230V',
        maxPowerInjection_kVA: 500,
        maxPowerConsumption_kVA: 500
      },
      neutralCompensators: [],
      cableUpgrades: []
    };

    const result = calculator.calculateWithSimulation(project, scenario, equipment);

    // Vérifier que tous les nœuds ont une tensionCible après initialisation
    project.nodes.forEach(node => {
      expect(node.tensionCible).toBe(230); // Valeur du transformateur
    });

    expect(result.srg2Result).toBeDefined();
    expect(result.srg2Result?.isActive).toBe(true);
  });
});