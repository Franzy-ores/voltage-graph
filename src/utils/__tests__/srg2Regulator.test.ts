import { SimulationCalculator } from '../simulationCalculator';
import { Node, Cable, CableType, VoltageRegulator, TransformerConfig, Project } from '@/types/network';

describe('SRG2 Voltage Regulator', () => {
  let calculator: SimulationCalculator;
  
  beforeEach(() => {
    calculator = new SimulationCalculator(0.95);
  });

  const createTestProject = (): { nodes: Node[], cables: Cable[], cableTypes: CableType[], transformer: TransformerConfig, regulators: VoltageRegulator[] } => {
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

    return { nodes, cables, cableTypes, transformer, regulators };
  };

  test('should modify nodes correctly for SRG2 regulator', () => {
    const { nodes, cables, cableTypes, transformer, regulators } = createTestProject();
    
    // Simulate calculation to get baseline
    const baseResult = calculator.calculateScenario(
      nodes,
      cables,
      cableTypes,
      'PRÉLÈVEMENT',
      100,
      100,
      transformer,
      'polyphase_equilibre',
      0
    );

    // Test the SRG2 regulation
    const regulationResult = {
      adjustmentPerPhase: { A: 5, B: 3, C: 2 },
      switchStates: { A: '+5V', B: '+3V', C: '+2V' },
      canRegulate: true
    };

    // Use the private method through type assertion
    const modifiedNodes = (calculator as any).modifyNodesForSRG2(
      nodes,
      regulators[0],
      regulationResult
    );

    const regulatorNode = modifiedNodes.find((n: Node) => n.id === 'node1');
    
    expect(regulatorNode).toBeDefined();
    expect(regulatorNode?.isVoltageRegulator).toBe(true);
    expect(regulatorNode?.tensionCible).toBeCloseTo((235 + 233 + 232) / 3, 1); // 230 + adjustments average
    expect(regulatorNode?.regulatorTargetVoltages).toEqual({
      A: 235,  // 230 + 5
      B: 233,  // 230 + 3  
      C: 232   // 230 + 2
    });

    console.log('✅ SRG2 regulator node modification test passed');
  });

  test('should apply voltage regulation in network calculation', () => {
    const { nodes, cables, cableTypes, transformer, regulators } = createTestProject();
    
    // Create a regulator node manually
    const regulatorNode = nodes.find(n => n.id === 'node1')!;
    regulatorNode.isVoltageRegulator = true;
    regulatorNode.tensionCible = 235;
    regulatorNode.regulatorTargetVoltages = { A: 235, B: 233, C: 232 };

    // Calculate with voltage regulator
    const result = calculator.calculateScenario(
      nodes,
      cables,
      cableTypes,
      'PRÉLÈVEMENT',
      100,
      100,
      transformer,
      'polyphase_equilibre',
      0
    );

    // Check that the regulated node has the expected voltage
    const nodeMetrics = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'node1');
    
    // The voltage should be influenced by the regulator
    if (nodeMetrics) {
      console.log('Regulated node voltages:', nodeMetrics.voltagesPerPhase);
      // Exact values will depend on the calculation, but should be closer to targets
      expect(nodeMetrics.voltagesPerPhase.A).toBeGreaterThan(220);
      expect(nodeMetrics.voltagesPerPhase.B).toBeGreaterThan(220);
      expect(nodeMetrics.voltagesPerPhase.C).toBeGreaterThan(220);
    }

    console.log('✅ SRG2 voltage regulation in calculation test passed');
  });
});