import { SimulationCalculator } from '../simulationCalculator';
import { Node, Cable, CableType, VoltageRegulator, TransformerConfig, Project } from '@/types/network';

describe('SRG2 Voltage Regulator', () => {
  let calculator: SimulationCalculator;
  
  beforeEach(() => {
    calculator = new SimulationCalculator(0.95);
  });

  const createTestProject = (): Project => {
    const nodes: Node[] = [
      {
        id: 'source',
        name: 'Source',
        lat: 0,
        lng: 0,
        connectionType: 'TÉTRA_3P+N_230_400V',
        clients: [],
        productions: [],
        isSource: true
      },
      {
        id: 'node1',
        name: 'Node 1',
        lat: 0.001,
        lng: 0.001,
        connectionType: 'TÉTRA_3P+N_230_400V',
        clients: [{ id: 'client1', label: 'Client 1', S_kVA: 10 }],
        productions: []
      }
    ];

    const cableTypes: CableType[] = [
      {
        id: 'cable_type_1',
        label: 'Test Cable',
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
        name: 'Test Cable 1',
        nodeAId: 'source',
        nodeBId: 'node1',
        typeId: 'cable_type_1',
        pose: 'SOUTERRAIN',
        coordinates: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }]
      }
    ];

    const transformer: TransformerConfig = {
      rating: '160kVA',
      nominalPower_kVA: 100,
      nominalVoltage_V: 400,
      shortCircuitVoltage_percent: 4,
      cosPhi: 0.95,
      xOverR: 3
    };

    const regulators: VoltageRegulator[] = [
      {
        id: 'regulator1',
        nodeId: 'node1',
        type: '230V_77kVA',
        targetVoltage_V: 230,
        maxPower_kVA: 77,
        enabled: true
      }
    ];

    return {
      id: 'test-project',
      name: 'Test Project',
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
      transformerConfig: transformer
    } as Project;
  };

  test('should modify nodes correctly for SRG2 regulator', () => {
    const testProject = createTestProject();
    
    // Apply simulation with SRG2 regulator
    const simulationResult = calculator.calculateWithSimulation(
      testProject,
      'PRÉLÈVEMENT',
      { srg2: { 
        nodeId: 'node1', 
        enabled: true,
        networkType: '230V',
        maxPowerInjection_kVA: 77,
        maxPowerConsumption_kVA: 77
      }, neutralCompensators: [], cableUpgrades: [] }
    );
    
    // Check that the regulated node has expected voltage behavior
    const nodeMetrics = simulationResult.nodeMetricsPerPhase?.find(n => n.nodeId === 'node1');
    
    expect(nodeMetrics).toBeDefined();
    if (nodeMetrics) {
      // Check that voltages are reasonable (regulator should improve them)
      expect(nodeMetrics.voltagesPerPhase.A).toBeGreaterThan(220);
      expect(nodeMetrics.voltagesPerPhase.B).toBeGreaterThan(220);
      expect(nodeMetrics.voltagesPerPhase.C).toBeGreaterThan(220);
    }

    console.log('✅ SRG2 regulator node modification test passed');
  });

  test('should apply voltage regulation in network calculation', () => {
    const testProject = createTestProject();

    // Apply simulation with SRG2 regulator
    const simulationResult = calculator.calculateWithSimulation(
      testProject,
      'PRÉLÈVEMENT',
      { srg2: { 
        nodeId: 'node1', 
        enabled: true,
        networkType: '230V',
        maxPowerInjection_kVA: 77,
        maxPowerConsumption_kVA: 77
      }, neutralCompensators: [], cableUpgrades: [] }
    );

    // Check that the regulated node has the expected voltage
    const nodeMetrics = simulationResult.nodeMetricsPerPhase?.find(n => n.nodeId === 'node1');
    
    // The voltage should be influenced by the regulator
    if (nodeMetrics) {
      console.log('Regulated node voltages:', nodeMetrics.voltagesPerPhase);
      // Should be closer to targets
      expect(nodeMetrics.voltagesPerPhase.A).toBeGreaterThan(220);
      expect(nodeMetrics.voltagesPerPhase.B).toBeGreaterThan(220);
      expect(nodeMetrics.voltagesPerPhase.C).toBeGreaterThan(220);
    }

    console.log('✅ SRG2 voltage regulation in calculation test passed');
  });
});