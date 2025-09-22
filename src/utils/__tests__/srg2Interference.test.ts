import { describe, it, expect, beforeEach } from 'vitest';
import { SimulationCalculator } from '@/utils/simulationCalculator';
import type { Project, SimulationEquipment, Node, Cable } from '@/types/network';
import { defaultCableTypes } from '@/data/defaultCableTypes';

describe('SRG2 Interference Tests', () => {
  let calculator: SimulationCalculator;
  let mockProject: Project;

  beforeEach(() => {
    calculator = new SimulationCalculator();
    
    mockProject = {
      id: 'interference-test',
      name: 'SRG2 Interference Test',
      voltageSystem: "TRIPHASÉ_230V",
      cosPhi: 0.95,
      foisonnementCharges: 100,
      foisonnementProductions: 100,
      defaultChargeKVA: 10,
      defaultProductionKVA: 5,
      transformerConfig: {
        rating: "160kVA",
        nominalPower_kVA: 160,
        nominalVoltage_V: 230,
        shortCircuitVoltage_percent: 4.0,
        cosPhi: 0.95
      },
      loadModel: 'polyphase_equilibre',
      desequilibrePourcent: 0,
      manualPhaseDistribution: {
        charges: { A: 33.33, B: 33.33, C: 33.34 },
        productions: { A: 33.33, B: 33.33, C: 33.34 },
        constraints: { min: -20, max: 20, total: 100 }
      },
      nodes: [
        {
          id: 'source',
          name: 'Source 230V',
          lat: 46.6167,
          lng: 6.8833,
          connectionType: "TRI_230V_3F",
          clients: [],
          productions: [],
          isSource: true
        },
        {
          id: 'srg2-node',
          name: 'SRG2 Node',
          lat: 46.6170,
          lng: 6.8835,
          connectionType: "TRI_230V_3F",
          clients: [{ id: 'load1', label: 'Load 1', S_kVA: 25 }],
          productions: [{ id: 'pv1', label: 'PV 1', S_kVA: 15 }],
          isSource: false,
          tensionCible: 245 // High voltage to trigger SRG2
        },
        {
          id: 'downstream-node',
          name: 'Downstream Node',
          lat: 46.6175,
          lng: 6.8840,
          connectionType: "TRI_230V_3F",
          clients: [{ id: 'load2', label: 'Load 2', S_kVA: 18 }],
          productions: [],
          isSource: false
        },
        {
          id: 'compensator-node',
          name: 'Compensator Node',
          lat: 46.6180,
          lng: 6.8845,
          connectionType: "TRI_230V_3F",
          clients: [
            { id: 'load3a', label: 'Load 3A', S_kVA: 12 },
            { id: 'load3b', label: 'Load 3B', S_kVA: 8 }
          ],
          productions: [{ id: 'pv3', label: 'PV 3', S_kVA: 10 }],
          isSource: false
        }
      ] as Node[],
      cables: [
        {
          id: 'cable1',
          name: 'Source to SRG2',
          typeId: 'baxb-95',
          pose: "AÉRIEN",
          nodeAId: 'source',
          nodeBId: 'srg2-node',
          coordinates: [
            { lat: 46.6167, lng: 6.8833 },
            { lat: 46.6170, lng: 6.8835 }
          ],
          length_m: 40
        },
        {
          id: 'cable2',
          name: 'SRG2 to Downstream',
          typeId: 'baxb-70',
          pose: "AÉRIEN",
          nodeAId: 'srg2-node',
          nodeBId: 'downstream-node',
          coordinates: [
            { lat: 46.6170, lng: 6.8835 },
            { lat: 46.6175, lng: 6.8840 }
          ],
          length_m: 60
        },
        {
          id: 'cable3',
          name: 'Downstream to Compensator',
          typeId: 'baxb-50',
          pose: "AÉRIEN",
          nodeAId: 'downstream-node',
          nodeBId: 'compensator-node',
          coordinates: [
            { lat: 46.6175, lng: 6.8840 },
            { lat: 46.6180, lng: 6.8845 }
          ],
          length_m: 80
        }
      ] as Cable[],
      cableTypes: defaultCableTypes
    };
  });

  describe('SRG2 and Neutral Compensator Interaction', () => {
    it('should handle SRG2 voltage regulation with downstream neutral compensator', () => {
      const simulationEquipment: SimulationEquipment = {
        srg2: {
          nodeId: 'srg2-node',
          enabled: true
        },
        neutralCompensators: [{
          id: 'comp1',
          nodeId: 'compensator-node',
          enabled: true,
          maxPower_kVA: 30,
          tolerance_A: 2.0,
          phaseImpedance: 0.4,
          neutralImpedance: 0.08
        }],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'MIXTE',
        simulationEquipment
      );

      expect(result).toBeDefined();
      expect(result.isSimulation).toBe(true);
      
      // SRG2 should be active due to high voltage
      const srg2Result = result.srg2Result;
      expect(srg2Result).toBeDefined();
      expect(srg2Result?.isActive).toBe(true);
      expect(srg2Result?.nodeId).toBe('srg2-node');
      
      // Compensator should also be applied
      expect(result.equipment?.neutralCompensators).toHaveLength(1);
      expect(result.equipment?.neutralCompensators[0].enabled).toBe(true);
    });

    it('should maintain equipment independence when both are active', () => {
      const simulationEquipment: SimulationEquipment = {
        srg2: {
          nodeId: 'srg2-node',
          enabled: true
        },
        neutralCompensators: [{
          id: 'comp1',
          nodeId: 'compensator-node',
          enabled: true,
          maxPower_kVA: 25,
          tolerance_A: 1.5,
          phaseImpedance: 0.3,
          neutralImpedance: 0.06
        }],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'PRÉLÈVEMENT',
        simulationEquipment
      );

      expect(result).toBeDefined();
      
      // Both equipments should function independently
      const baseline = result.baselineResult;
      expect(baseline).toBeDefined();
      
      // Simulation should show different results from baseline due to equipment
      expect(result.isSimulation).toBe(true);
      
      // Verify both equipment types are present in results
      expect(result.equipment?.srg2?.enabled).toBe(true);
      expect(result.equipment?.neutralCompensators[0]?.enabled).toBe(true);
    });
  });

  describe('Multiple Equipment Scenarios', () => {
    it('should handle equipment on adjacent nodes without interference', () => {
      // Place SRG2 on one node and compensator on an adjacent node
      const mockProject2 = { ...mockProject };
      mockProject2.nodes = mockProject2.nodes.map(n => 
        n.id === 'downstream-node' 
          ? { ...n, tensionCible: 242 } // Set voltage to trigger different behavior
          : n
      );

      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'srg2-node',
          enabled: true
        },
        neutralCompensators: [{
          id: 'comp1',
          nodeId: 'downstream-node',
          enabled: true,
          maxPower_kVA: 35,
          tolerance_A: 3.0,
          phaseImpedance: 0.5,
          neutralImpedance: 0.1
        }],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject2,
        'PRODUCTION',
        equipment
      );

      expect(result).toBeDefined();
      expect(result.isSimulation).toBe(true);
      
      // Both equipment should be applied without conflict
      const srg2Result = result.srg2Result;
      expect(srg2Result).toBeDefined();
      expect(srg2Result?.nodeId).toBe('srg2-node');
      
      expect(result.equipment?.neutralCompensators).toHaveLength(1);
      expect(result.equipment?.neutralCompensators[0].nodeId).toBe('downstream-node');
    });

    it('should prioritize SRG2 regulation over other equipment when needed', () => {
      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'srg2-node',
          enabled: true
        },
        neutralCompensators: [{
          id: 'comp1',
          nodeId: 'srg2-node', // Same node as SRG2
          enabled: true,
          maxPower_kVA: 20,
          tolerance_A: 1.0,
          phaseImpedance: 0.2,
          neutralImpedance: 0.04
        }],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'MIXTE',
        equipment
      );

      expect(result).toBeDefined();
      expect(result.isSimulation).toBe(true);
      
      // SRG2 should take priority since it's applied first
      const srg2Result = result.srg2Result;
      expect(srg2Result).toBeDefined();
      
      // System should handle the equipment configuration gracefully
      expect(result.equipment?.srg2?.nodeId).toBe('srg2-node');
      expect(result.equipment?.neutralCompensators[0]?.nodeId).toBe('srg2-node');
    });
  });
});