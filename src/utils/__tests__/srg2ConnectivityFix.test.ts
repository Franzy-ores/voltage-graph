// SRG2 CONNECTIVITY FIX: Test validation of the fixes for SRG2 node exclusion
import { describe, test, expect, beforeEach } from 'vitest';
import { SimulationCalculator } from '../simulationCalculator';
import { getConnectedNodes } from '../networkConnectivity';
import type { Project, Node, Cable, SimulationEquipment, ClientCharge, CableType, CalculationScenario } from '../../types/network';

describe('SRG2 Connectivity Fix - Validation Tests', () => {
  let calculator: SimulationCalculator;

  beforeEach(() => {
    calculator = new SimulationCalculator();
  });

  // Helper to create test project with SRG2 node
  const createTestProjectWithSRG2 = (): { project: Project; srg2NodeId: string } => {
    const sourceNode: Node = {
      id: 'SOURCE',
      name: 'Source',
      lat: 0,
      lng: 0,
      isSource: true,
      connectionType: 'TRI_230V_3F',
      clients: [],
      productions: [],
      tensionCible: 230
    };

    const clientCharge: ClientCharge = {
      id: 'client1',
      label: 'Load 1',
      S_kVA: 10
    };

    const srg2Node: Node = {
      id: 'SRG2_NODE',
      name: 'SRG2 Regulator Node',
      lat: 0,
      lng: 0,
      isSource: false,
      connectionType: 'TRI_230V_3F',
      clients: [clientCharge],
      productions: [],
      tensionCible: 230
    };

    const downstreamClient: ClientCharge = {
      id: 'client2', 
      label: 'Load 2',
      S_kVA: 5
    };

    const downstreamNode: Node = {
      id: 'DOWNSTREAM',
      name: 'Downstream Node',
      lat: 0,
      lng: 0,
      isSource: false,
      connectionType: 'TRI_230V_3F',
      clients: [downstreamClient],
      productions: [],
      tensionCible: 230
    };

    const cable1: Cable = {
      id: 'CABLE_1',
      name: 'Cable 1',
      nodeAId: 'SOURCE',
      nodeBId: 'SRG2_NODE',
      typeId: 'default',
      pose: 'AÉRIEN',
      coordinates: [{ lat: 0, lng: 0 }, { lat: 0, lng: 100 }]
    };

    const cable2: Cable = {
      id: 'CABLE_2',
      name: 'Cable 2', 
      nodeAId: 'SRG2_NODE',
      nodeBId: 'DOWNSTREAM',
      typeId: 'default',
      pose: 'AÉRIEN',
      coordinates: [{ lat: 0, lng: 100 }, { lat: 0, lng: 200 }]
    };

    const cableType: CableType = {
      id: 'default',
      label: 'Default Cable',
      R12_ohm_per_km: 0.1,
      X12_ohm_per_km: 0.08,
      R0_ohm_per_km: 0.12,
      X0_ohm_per_km: 0.1,
      matiere: 'CUIVRE',
      posesPermises: ['AÉRIEN', 'SOUTERRAIN'],
      maxCurrent_A: 100
    };

    const project: Project = {
      id: 'test',
      name: 'SRG2 Connectivity Test',
      voltageSystem: 'TRIPHASÉ_230V',
      cosPhi: 0.95,
      nodes: [sourceNode, srg2Node, downstreamNode],
      cables: [cable1, cable2],
      cableTypes: [cableType],
      transformerConfig: { nominalVoltage_V: 230 } as any,
      foisonnementCharges: 100,
      foisonnementProductions: 100,
      defaultChargeKVA: 10,
      defaultProductionKVA: 5
    };

    return { project, srg2NodeId: 'SRG2_NODE' };
  };

  // TEST 1: Verify SRG2 nodes are detected as connected
  test('should detect SRG2 nodes as connected in network connectivity', () => {
    const { project } = createTestProjectWithSRG2();
    
    // Mark the SRG2 node as having SRG2 applied
    const srg2Node = project.nodes.find(n => n.id === 'SRG2_NODE')!;
    srg2Node.srg2Applied = true;
    
    const connectedNodes = getConnectedNodes(project.nodes, project.cables);
    
    // All nodes should be connected
    expect(connectedNodes.size).toBe(3);
    expect(connectedNodes.has('SOURCE')).toBe(true);
    expect(connectedNodes.has('SRG2_NODE')).toBe(true);
    expect(connectedNodes.has('DOWNSTREAM')).toBe(true);
    
    console.log('✅ SRG2 node connectivity test passed');
  });

  // TEST 2: Verify SRG2 nodes appear in electrical calculation results
  test('should include SRG2 nodes in electrical calculation nodeMetricsPerPhase', async () => {
    const { project, srg2NodeId } = createTestProjectWithSRG2();
    
    // Run basic electrical calculation (without SRG2 regulation)
    const scenario: CalculationScenario = 'PRÉLÈVEMENT';
    const result = calculator.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      scenario,
      100,
      100,
      project.transformerConfig,
      'polyphase_equilibre',
      0
    );
    
    // Verify all nodes appear in results
    expect(result.nodeMetricsPerPhase).toBeDefined();
    expect(result.nodeMetricsPerPhase!.length).toBe(3);
    
    const srg2NodeMetrics = result.nodeMetricsPerPhase!.find(nm => nm.nodeId === srg2NodeId);
    expect(srg2NodeMetrics).toBeDefined();
    expect(srg2NodeMetrics!.calculatedVoltagesPerPhase).toBeDefined();
    expect(srg2NodeMetrics!.calculatedVoltagesPerPhase.A).toBeGreaterThan(200);
    expect(srg2NodeMetrics!.calculatedVoltagesPerPhase.B).toBeGreaterThan(200);
    expect(srg2NodeMetrics!.calculatedVoltagesPerPhase.C).toBeGreaterThan(200);
    
    console.log('✅ SRG2 node voltage calculation test passed');
  });

  // TEST 3: Verify SRG2 regulation works with proper voltage data
  test('should successfully apply SRG2 regulation when node has voltage data', async () => {
    const { project, srg2NodeId } = createTestProjectWithSRG2();
    
    const simulationEquipment: SimulationEquipment = {
      srg2: {
        nodeId: srg2NodeId,
        enabled: true
      },
      neutralCompensators: [],
      cableUpgrades: []
    };
    
    const scenario: CalculationScenario = 'PRÉLÈVEMENT';
    
    // Run simulation with SRG2
    const result = calculator.calculateWithSimulation(
      project,
      scenario,
      simulationEquipment
    );
    
    // Verify SRG2 result exists and is not in error state
    expect(result.srg2Result).toBeDefined();
    expect(result.srg2Result!.nodeId).toBe(srg2NodeId);
    expect(result.srg2Result!.errorMessage).toBeUndefined();
    expect(result.srg2Result!.originalVoltage).toBeGreaterThan(200);
    
    console.log('✅ SRG2 regulation with voltage data test passed');
  });

  // TEST 4: Verify multiple SRG2 nodes can coexist
  test('should handle multiple SRG2 nodes without exclusion', () => {
    const { project } = createTestProjectWithSRG2();
    
    const thirdClient: ClientCharge = {
      kVA: 8,
      powerFactor: 0.95,
      phases: ['A', 'B', 'C']
    };
    
    // Add another SRG2 node
    const secondSrg2Node: Node = {
      id: 'SRG2_NODE_2',
      name: 'Second SRG2 Node',
      lat: 0,
      lng: 0,
      isSource: false,
      connectionType: 'TRI_230V_3F',
      clients: [thirdClient],
      productions: [],
      tensionCible: 230,
      srg2Applied: true
    };
    
    const additionalCable: Cable = {
      id: 'CABLE_3',
      nodeAId: 'DOWNSTREAM',
      nodeBId: 'SRG2_NODE_2',
      typeId: 'default',
      coordinates: [{ lat: 0, lng: 200 }, { lat: 0, lng: 300 }]
    };
    
    project.nodes.push(secondSrg2Node);
    project.cables.push(additionalCable);
    
    // Mark first SRG2 node as well
    const firstSrg2Node = project.nodes.find(n => n.id === 'SRG2_NODE')!;
    firstSrg2Node.srg2Applied = true;
    
    const connectedNodes = getConnectedNodes(project.nodes, project.cables);
    
    // All nodes including both SRG2 nodes should be connected
    expect(connectedNodes.size).toBe(4);
    expect(connectedNodes.has('SRG2_NODE')).toBe(true);
    expect(connectedNodes.has('SRG2_NODE_2')).toBe(true);
    
    console.log('✅ Multiple SRG2 nodes connectivity test passed');
  });
});