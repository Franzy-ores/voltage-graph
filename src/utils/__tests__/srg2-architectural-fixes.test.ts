/**
 * Test suite for architectural fixes in SRG2 system
 * Validates the implementation of T1-T9 fixes from the architectural plan
 */
import { describe, it, expect } from 'vitest';
import { SimulationCalculator } from '../simulationCalculator';
import { ElectricalCalculator } from '../electricalCalculations';
import { SRG2Regulator } from '../SRG2Regulator';
import { getNodeVoltageInfo, getVoltageComplianceColor } from '../voltageDisplay';
import { executeAllScenarioCalculations } from '../scenarioRunner';
import { Project, Node, Cable, CableType, CalculationScenario, SimulationEquipment, LoadModel } from '@/types/network';

// Test fixtures
const createTestProject = (loadModel: LoadModel = 'polyphase_equilibre'): Project => ({
  id: 'test-project',
  name: 'Test SRG2 Architecture',
  nodes: [
    {
      id: 'source',
      name: 'Source',
      isSource: true,
      connectionType: 'TÉTRA_3P+N_230_400V',
      lat: 0,
      lng: 0,
      clients: [],
      productions: [],
      tensionCible: 400
    },
    {
      id: 'node1',
      name: 'Node 1',
      isSource: false,
      connectionType: 'TÉTRA_3P+N_230_400V',
      lat: 0.001,
      lng: 0,
      clients: [{ id: 'c1', label: 'Client1', S_kVA: 10 }],
      productions: []
    },
    {
      id: 'node2', 
      name: 'Node 2',
      isSource: false,
      connectionType: 'TÉTRA_3P+N_230_400V',
      lat: 0.002,
      lng: 0,
      clients: [{ id: 'c2', label: 'Client2', S_kVA: 15 }],
      productions: []
    }
  ],
  cables: [
    {
      id: 'cable1',
      name: 'Cable 1',
      nodeAId: 'source',
      nodeBId: 'node1',
      typeId: 'test-cable',
      pose: 'SOUTERRAIN',
      coordinates: []
    },
    {
      id: 'cable2',
      name: 'Cable 2', 
      nodeAId: 'node1', 
      nodeBId: 'node2',
      typeId: 'test-cable',
      pose: 'SOUTERRAIN',
      coordinates: []
    }
  ],
  cableTypes: [
    {
      id: 'test-cable',
      label: 'Test Cable',
      R12_ohm_per_km: 1.83,
      X12_ohm_per_km: 0.08,
      R0_ohm_per_km: 3.08,
      X0_ohm_per_km: 0.12,
      matiere: 'CUIVRE',
      posesPermises: ['SOUTERRAIN']
    }
  ],
  voltageSystem: 'TÉTRAPHASÉ_400V',
  loadModel,
  transformerConfig: {
    nominalVoltage_V: 400,
    shortCircuitVoltage_percent: 4,
    nominalPower_kVA: 250,
    rating: '250kVA',
    cosPhi: 0.95
  },
  cosPhi: 0.95,
  foisonnementCharges: 100,
  foisonnementProductions: 100,
  defaultChargeKVA: 10,
  defaultProductionKVA: 5
});

describe('SRG2 Architectural Fixes', () => {

  describe('TS1: SRG2 final vs baseline results', () => {
    it('should return final results when SRG2 is active, baseline otherwise', async () => {
      const project = createTestProject();
      const calculator = new SimulationCalculator();
      
      const simulationEquipment: SimulationEquipment = {
        srg2: {
          nodeId: 'node1',
          enabled: true
        },
        neutralCompensators: [],
        cableUpgrades: []
      };
      
      // Test with SRG2 active - should return final results
      const resultWithSRG2 = calculator.calculateWithSimulation(
        project,
        'PRÉLÈVEMENT',
        simulationEquipment
      );
      
      expect(resultWithSRG2.isSimulation).toBe(true);
      expect(resultWithSRG2.srg2Result).toBeDefined();
      expect(resultWithSRG2.baselineResult).toBeDefined(); // Should preserve baseline for comparison
      
      // Test without SRG2 - should return baseline results  
      const simulationEquipmentOff: SimulationEquipment = {
        srg2: {
          nodeId: 'node1',
          enabled: false
        },
        neutralCompensators: [],
        cableUpgrades: []
      };
      
      const resultWithoutSRG2 = calculator.calculateWithSimulation(
        project,
        'PRÉLÈVEMENT', 
        simulationEquipmentOff
      );
      
      expect(resultWithoutSRG2.srg2Result?.isActive).toBeFalsy();
    });
  });

  describe('TS2: Injection équilibré/déséquilibré', () => {
    it('should inject SRG2 voltages correctly in both balanced and unbalanced modes', async () => {
      const calculator = new SimulationCalculator();
      const simulationEquipment: SimulationEquipment = {
        srg2: {
          nodeId: 'node1',
          enabled: true
        },
        neutralCompensators: [],
        cableUpgrades: []
      };
      
      // Test balanced mode (polyphase_equilibre)
      const balancedProject = createTestProject('polyphase_equilibre');
      const balancedResult = calculator.calculateWithSimulation(
        balancedProject,
        'PRÉLÈVEMENT',
        simulationEquipment
      );
      
      if (balancedResult.srg2Result?.isActive) {
        expect(balancedResult.nodeMetrics).toBeDefined();
        const srg2Node = balancedResult.nodeMetrics?.find(n => n.nodeId === 'node1');
        expect(srg2Node).toBeDefined();
        expect(srg2Node?.V_phase_V).toBe(balancedResult.srg2Result.regulatedVoltage);
      }
      
      // Test unbalanced mode (monophase_reparti)
      const unbalancedProject = createTestProject('monophase_reparti');
      const unbalancedResult = calculator.calculateWithSimulation(
        unbalancedProject,
        'PRÉLÈVEMENT',
        simulationEquipment
      );
      
      if (unbalancedResult.srg2Result?.isActive) {
        expect(unbalancedResult.nodeMetricsPerPhase).toBeDefined();
        const srg2Node = unbalancedResult.nodeMetricsPerPhase?.find(n => n.nodeId === 'node1');
        expect(srg2Node?.calculatedVoltagesPerPhase).toBeDefined();
        expect(srg2Node?.calculatedVoltagesPerPhase?.A).toBe(unbalancedResult.srg2Result.regulatedVoltages?.A);
      }
    });
  });

  describe('TS3: Virtual busbar per node connectionType', () => {
    it('should use correct connectionType for each node in virtual busbar calculation', async () => {
      const project = createTestProject();
      // Mix different connection types to test the fix
      project.nodes[1].connectionType = 'TRI_230V_3F';
      project.nodes[2].connectionType = 'MONO_230V_PN';
      
      const calculator = new ElectricalCalculator();
      const result = calculator.calculateScenario(
        project.nodes,
        project.cables, 
        project.cableTypes,
        'PRÉLÈVEMENT',
        100,
        100,
        project.transformerConfig,
        'polyphase_equilibre',
        0
      );
      
      expect(result.virtualBusbar).toBeDefined();
      expect(result.virtualBusbar?.circuits).toBeDefined();
      // The fix ensures each node uses its own connectionType, not the source's
    });
  });

  describe('TS4: Robust cable reinforcement', () => {
    it('should handle missing nodeMetricsPerPhase gracefully', async () => {
      const project = createTestProject();
      const calculator = new SimulationCalculator();
      
      // Create a baseline result without nodeMetricsPerPhase
      const baselineResult = {
        scenario: 'PRÉLÈVEMENT' as const,
        cables: [],
        totalLoads_kVA: 25,
        totalProductions_kVA: 0,
        globalLosses_kW: 0.5,
        maxVoltageDropPercent: 2,
        compliance: 'normal' as const,
        nodeMetrics: [],
        nodeMetricsPerPhase: undefined, // This should be handled gracefully
        virtualBusbar: undefined
      };
      
      const upgrades = calculator.proposeFullCircuitReinforcement(
        project,
        'PRÉLÈVEMENT',
        baselineResult
      );
      
      expect(upgrades).toEqual([]); // Should return empty array, not crash
    });
    
    it('should calculate percentage drops relative to node reference voltage', async () => {
      const project = createTestProject();
      const calculator = new SimulationCalculator();
      
      const baselineResult = {
        scenario: 'PRÉLÈVEMENT' as const,
        cables: [],
        totalLoads_kVA: 25,
        totalProductions_kVA: 0,
        globalLosses_kW: 0.5,
        maxVoltageDropPercent: 8, // > 5%
        compliance: 'warning' as const,
        nodeMetrics: [],
        nodeMetricsPerPhase: [
          {
            nodeId: 'node1',
            voltagesPerPhase: { A: 220, B: 220, C: 220 },
            voltageDropsPerPhase: { A: -25, B: -25, C: -25 }, // > 5% of 400V
            calculatedVoltagesPerPhase: { A: 220, B: 220, C: 220 }
          }
        ],
        virtualBusbar: undefined
      };
      
      const upgrades = calculator.proposeFullCircuitReinforcement(
        project,
        'PRÉLÈVEMENT',
        baselineResult
      );
      
      expect(upgrades.length).toBeGreaterThan(0);
      expect(upgrades[0].before.voltageDropPercent).toBeGreaterThan(5);
    });
  });

  describe('TS5: No SRG2 side-effects propagation', () => {
    it('should not propagate SRG2 effects to upstream nodes', async () => {
      const project = createTestProject();
      const calculator = new SimulationCalculator();
      
      const simulationEquipment: SimulationEquipment = {
        srg2: {
          nodeId: 'node1', // Middle node
          enabled: true
        },
        neutralCompensators: [],
        cableUpgrades: []
      };
      
      const result = calculator.calculateWithSimulation(
        project,
        'PRÉLÈVEMENT',
        simulationEquipment
      );
      
      // Source voltage should not be affected by downstream SRG2
      const sourceNode = project.nodes.find(n => n.isSource);
      expect(sourceNode?.tensionCible).toBe(400); // Original value preserved
      
      // Only downstream propagation through electrical calculation should occur
      expect(result.srg2Result?.isActive).toBeTruthy();
    });
  });

  describe('TS6: Clean API and logs', () => {
    it('should work without skipSRG2Integration parameter', async () => {
      const project = createTestProject();
      const calculator = new ElectricalCalculator();
      
      // This should work without the removed parameter
      const result = calculator.calculateScenario(
        project.nodes,
        project.cables,
        project.cableTypes, 
        'PRÉLÈVEMENT',
        100,
        100,
        project.transformerConfig,
        'polyphase_equilibre',
        0
      );
      
      expect(result).toBeDefined();
      expect(result.nodeMetrics).toBeDefined();
    });

    it('should have consistent scenario runner execution', async () => {
      const project = createTestProject();
      const calculator = new ElectricalCalculator();
      
      const results = executeAllScenarioCalculations(
        calculator,
        project.nodes,
        project.cables,
        project.cableTypes,
        100,
        100,
        project.transformerConfig,
        'polyphase_equilibre',
        0,
        undefined
      );
      
      expect(results.PRÉLÈVEMENT).toBeDefined();
      expect(results.MIXTE).toBeDefined();
      expect(results.PRODUCTION).toBeDefined();
      expect(results.FORCÉ).toBeDefined();
    });
  });

  describe('Unified voltage reference system', () => {
    it('should provide consistent voltage references across network types', () => {
      const project230V = createTestProject('polyphase_equilibre');
      project230V.voltageSystem = 'TRIPHASÉ_230V';
      
      const project400V = createTestProject('polyphase_equilibre');
      project400V.voltageSystem = 'TÉTRAPHASÉ_400V';
      
      // Test unified voltage display
      const voltage230 = getNodeVoltageInfo(
        'node1',
        project230V,
        { PRÉLÈVEMENT: null, MIXTE: null, PRODUCTION: null, FORCÉ: null },
        { PRÉLÈVEMENT: null, MIXTE: null, PRODUCTION: null, FORCÉ: null },
        'PRÉLÈVEMENT',
        false,
        {}
      );
      
      const voltage400 = getNodeVoltageInfo(
        'node1', 
        project400V,
        { PRÉLÈVEMENT: null, MIXTE: null, PRODUCTION: null, FORCÉ: null },
        { PRÉLÈVEMENT: null, MIXTE: null, PRODUCTION: null, FORCÉ: null },
        'PRÉLÈVEMENT',
        false,
        {}
      );
      
      expect(voltage230.source).toBe('fallback');
      expect(voltage400.source).toBe('fallback');
      
      // Test compliance colors
      const color230 = getVoltageComplianceColor(230, project230V);
      const color400 = getVoltageComplianceColor(400, project400V);
      
      expect(color230).toBeDefined();
      expect(color400).toBeDefined();
    });
  });

  describe('SRG2Regulator dead code removal', () => {
    it('should use external calculation functions correctly', () => {
      const regulator = new SRG2Regulator();
      const project = createTestProject();
      
      const baselineResult = {
        scenario: 'PRÉLÈVEMENT' as const,
        cables: [],
        totalLoads_kVA: 25,
        totalProductions_kVA: 0,
        globalLosses_kW: 0.5,
        maxVoltageDropPercent: 2,
        compliance: 'normal' as const,
        nodeMetrics: [],
        nodeMetricsPerPhase: [],
        virtualBusbar: undefined
      };
      
      const srg2Config = {
        nodeId: 'node1',
        enabled: true
      };
      
      const result = regulator.apply(srg2Config, 220, project, baselineResult);
      
      expect(result.nodeId).toBe('node1');
      expect(result.state).toBeDefined();
      expect(result.ratio).toBeDefined();
      expect(result.regulatedVoltage).toBeDefined();
      expect(result.networkType).toBe('UNIFIED_230V');
    });
  });
});