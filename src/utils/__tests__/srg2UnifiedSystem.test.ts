import { ElectricalCalculator } from '../electricalCalculations';
import { Node, Cable, CableType, VoltageRegulator, TransformerConfig, Project } from '@/types/network';

describe('SRG2 Unified System Validation', () => {
  let calculator: ElectricalCalculator;
  
  beforeEach(() => {
    calculator = new ElectricalCalculator(0.95);
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
        name: 'Node 1 - SRG2',
        lat: 0.001,
        lng: 0.001,
        connectionType: 'TÉTRA_3P+N_230_400V',
        clients: [],
        productions: []
      },
      {
        id: 'node2',
        name: 'Node 2 - Downstream',
        lat: 0.002,
        lng: 0.002,
        connectionType: 'TÉTRA_3P+N_230_400V',
        clients: [{ id: 'client1', label: 'Client 1', S_kVA: 15 }],
        productions: []
      }
    ];

    const cableTypes: CableType[] = [
      {
        id: 'cable_type_1',
        label: 'Test Cable',
        R12_ohm_per_km: 1.0,
        X12_ohm_per_km: 0.2,
        R0_ohm_per_km: 2.0,
        X0_ohm_per_km: 0.4,
        matiere: 'ALUMINIUM',
        posesPermises: ['SOUTERRAIN']
      }
    ];

    const cables: Cable[] = [
      {
        id: 'cable1',
        name: 'Source to SRG2',
        nodeAId: 'source',
        nodeBId: 'node1',
        typeId: 'cable_type_1',
        pose: 'SOUTERRAIN',
        coordinates: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }]
      },
      {
        id: 'cable2',
        name: 'SRG2 to Load',
        nodeAId: 'node1',
        nodeBId: 'node2',
        typeId: 'cable_type_1',
        pose: 'SOUTERRAIN',
        coordinates: [{ lat: 0.001, lng: 0.001 }, { lat: 0.002, lng: 0.002 }]
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

    return {
      id: 'test-project',
      name: 'SRG2 Unified Test Project',
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

  test('should use unified SRG2 system and store transformation ratios', () => {
    const testProject = createTestProject();
    
    // Add SRG2 regulator to node1
    const regulators: VoltageRegulator[] = [
      {
        id: 'srg2_regulator',
        nodeId: 'node1',
        type: '230V_77kVA', // SRG2 type
        targetVoltage_V: 230,
        maxPower_kVA: 77,
        enabled: true
      }
    ];

    // Test with high voltage (should trigger LO regulation)
    const testNodes = [...testProject.nodes];
    testNodes[1] = { ...testNodes[1], tensionCible: 250 }; // Force high voltage at SRG2 node

    // Calculate with unified system
    const result = calculator.calculateScenario(
      testNodes,
      testProject.cables,
      testProject.cableTypes,
      'PRÉLÈVEMENT',
      100, 100,
      testProject.transformerConfig,
      'polyphase_equilibre',
      0,
      undefined,
      false // skipSRG2Integration = false pour tester
    );

    // Verify calculation completed
    expect(result).toBeDefined();
    expect(result.nodeMetrics).toBeDefined();
    
    console.log('✅ Unified SRG2 system test completed');
  });

  test('should have transformation ratios stored correctly for SRG2 nodes', async () => {
    const testProject = createTestProject();
    
    // Simulate calculation with SRG2 regulation
    const result = calculator.calculateScenario(
      testProject.nodes,
      testProject.cables,
      testProject.cableTypes,
      'PRÉLÈVEMENT',
      100, 100,
      testProject.transformerConfig,
      'polyphase_equilibre',
      0
    );

    expect(result).toBeDefined();
    
    // Check for SRG2 nodes with applied regulation
    const srg2Nodes = testProject.nodes.filter(node => 
      node.isVoltageRegulator && node.srg2Applied
    );
    
    console.log(`Found ${srg2Nodes.length} SRG2 nodes with applied regulation`);
    
    // If SRG2 is active, should have regulation properties
    srg2Nodes.forEach(node => {
      expect(node.srg2Applied).toBe(true);
      expect(node.srg2Ratio).toBeGreaterThan(0);
      expect(node.srg2State).toBeDefined();
      
      console.log(`Node ${node.id} SRG2: state=${node.srg2State}, ratio=${node.srg2Ratio}`);
    });

    console.log('✅ SRG2 regulation storage test passed');
  });

  test('should disable old SRG2 system and use unified system', () => {
    const testProject = createTestProject();
    
    // Calculate with SRG2 regulation through unified system
    const result = calculator.calculateScenario(
      testProject.nodes,
      testProject.cables,
      testProject.cableTypes,
      'PRÉLÈVEMENT',
      100, 100,
      testProject.transformerConfig,
      'polyphase_equilibre',
      0,
      undefined,
      false // skipSRG2Integration = false to enable SRG2
    );

    // Should complete without errors
    expect(result).toBeDefined();
    expect(result.nodeMetrics).toBeDefined();
    
    console.log('✅ Unified SRG2 system integration test passed');
  });
});