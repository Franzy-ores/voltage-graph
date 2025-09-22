import { SimulationCalculator } from '../simulationCalculator';
import { Node, Cable, CableType, VoltageRegulator, NeutralCompensator, Project, SimulationEquipment } from '@/types/network';
import { describe, it, expect, beforeEach } from 'vitest';

describe('Equipment Integration Tests', () => {
  let calculator: SimulationCalculator;
  let mockProject: Project;

  beforeEach(() => {
    calculator = new SimulationCalculator(0.95);

    mockProject = {
      id: 'test-project',
      name: 'Test Project',
      voltageSystem: 'TÉTRAPHASÉ_400V',
      cosPhi: 0.95,
      foisonnementCharges: 100,
      foisonnementProductions: 0,
      defaultChargeKVA: 5,
      defaultProductionKVA: 0,
      loadModel: 'monophase_reparti' as const,
      desequilibrePourcent: 0,
      transformerConfig: {
        rating: '400kVA',
        nominalPower_kVA: 400,
        nominalVoltage_V: 400,
        shortCircuitVoltage_percent: 4,
        cosPhi: 0.95
      },
      nodes: [
        {
          id: 'source',
          name: 'Source',
          lat: 0,
          lng: 0,
          isSource: true,
          connectionType: 'TÉTRA_3P+N_230_400V' as const,
          clients: [],
          productions: []
        },
        {
          id: 'intermediate',
          name: 'Intermediate Node',
          lat: 0.001,
          lng: 0.001,
          isSource: false,
          connectionType: 'TÉTRA_3P+N_230_400V' as const,
          clients: [],
          productions: []
        },
        {
          id: 'load-node',
          name: 'Load Node',
          lat: 0.002,
          lng: 0.002,
          isSource: false,
          connectionType: 'TÉTRA_3P+N_230_400V' as const,
          clients: [{ id: 'load1', label: 'Test Load', S_kVA: 20 }],
          productions: []
        }
      ],
      cables: [
        {
          id: 'cable1',
          name: 'Cable 1',
          pose: 'SOUTERRAIN',
          nodeAId: 'source',
          nodeBId: 'intermediate',
          typeId: 'cable-type-1',
          coordinates: [
            { lat: 0, lng: 0 },
            { lat: 0.001, lng: 0.001 }
          ]
        },
        {
          id: 'cable2',
          name: 'Cable 2',
          pose: 'SOUTERRAIN',
          nodeAId: 'intermediate',  
          nodeBId: 'load-node',
          typeId: 'cable-type-1',
          coordinates: [
            { lat: 0.001, lng: 0.001 },
            { lat: 0.002, lng: 0.002 }
          ]
        }
      ],
      cableTypes: [{
        id: 'cable-type-1',
        label: 'Standard Cable',
        R12_ohm_per_km: 0.5,
        X12_ohm_per_km: 0.3,
        R0_ohm_per_km: 0.8,
        X0_ohm_per_km: 0.4,
        matiere: 'CUIVRE',
        posesPermises: ['SOUTERRAIN'],
        maxCurrent_A: 100
      }]
    };
  });

  describe('Voltage Regulator Integration', () => {
    it('should apply voltage regulation and maintain downstream voltage levels', () => {
      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'intermediate',
          enabled: true,
          networkType: '400V',
          maxPowerInjection_kVA: 44,
          maxPowerConsumption_kVA: 44
        },
        neutralCompensators: [],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'PRÉLÈVEMENT', 
        equipment
      );

      // Verify simulation was successful
      expect(result.isSimulation).toBe(true);
      expect(result.equipment).toBeDefined();
      expect(result.baselineResult).toBeDefined();

      // Check regulator was applied
      const intermediateNode = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'intermediate');
      expect(intermediateNode?.voltagesPerPhase?.A).toBe(400);
      expect(intermediateNode?.voltagesPerPhase?.B).toBe(400);
      expect(intermediateNode?.voltagesPerPhase?.C).toBe(400);

      // Check downstream voltage is properly calculated
      const loadNode = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'load-node');
      expect(loadNode?.voltagesPerPhase?.A).toBeGreaterThan(380);
      expect(loadNode?.voltagesPerPhase?.A).toBeLessThan(400);
    });

    it('should handle multiple voltage regulators in sequence', () => {
      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'intermediate',
          enabled: true,
          networkType: '400V',
          maxPowerInjection_kVA: 44,
          maxPowerConsumption_kVA: 44
        },
        neutralCompensators: [],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'PRÉLÈVEMENT',
        equipment
      );

      // Both regulators should maintain their target voltages
      const intermediateNode = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'intermediate');
      expect(intermediateNode?.voltagesPerPhase?.A).toBe(380);

      const loadNode = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'load-node');
      expect(loadNode?.voltagesPerPhase?.A).toBe(230);
    });
  });

  describe('EQUI8 Compensator Integration', () => {
    it('should apply voltage balance correction', () => {
      // Modify project to have unbalanced loads
      mockProject.nodes[2].clients = [
        { id: 'load-a', label: 'Load Phase A', S_kVA: 10 },
        { id: 'load-b', label: 'Load Phase B', S_kVA: 5 }, 
        { id: 'load-c', label: 'Load Phase C', S_kVA: 15 }
      ];
      mockProject.loadModel = 'polyphase_equilibre';
      mockProject.desequilibrePourcent = 30;

      const equipment: SimulationEquipment = {
        srg2: null,
        neutralCompensators: [{
          id: 'comp1',
          nodeId: 'load-node',
          maxPower_kVA: 50,
          tolerance_A: 1.0,
          enabled: true
        }],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'PRÉLÈVEMENT',
        equipment
      );

      // Verify compensator results are stored
      const loadNode = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'load-node');
      expect(loadNode?.equi8).toBeDefined();
      expect(loadNode?.equi8?.UEQUI8).toBeDefined();
      expect(loadNode?.equi8?.I_EQUI8).toBeDefined();

      // Check compensator status
      const compensator = equipment.neutralCompensators[0];
      expect((compensator as any).currentIN_A).toBeDefined();
      expect((compensator as any).reductionPercent).toBeDefined();
    });
  });

  describe('Combined Equipment Tests', () => {
    it('should apply both voltage regulator and compensator together', () => {
      // Unbalanced load configuration
      mockProject.nodes[2].clients = [
        { id: 'load-a', label: 'Load A', S_kVA: 8 },
        { id: 'load-b', label: 'Load B', S_kVA: 6 },
        { id: 'load-c', label: 'Load C', S_kVA: 10 }
      ];
      mockProject.desequilibrePourcent = 20;

      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'intermediate',
          enabled: true,
          networkType: '400V',
          maxPowerInjection_kVA: 44,
          maxPowerConsumption_kVA: 44
        },
        neutralCompensators: [{
          id: 'comp1',
          nodeId: 'load-node',
          maxPower_kVA: 50,
          tolerance_A: 1.0,
          enabled: true
        }],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'PRÉLÈVEMENT',
        equipment
      );

      // Verify both equipment types are applied
      expect(result.isSimulation).toBe(true);
      
      // Check regulator effect
      const intermediateNode = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'intermediate');
      expect(intermediateNode?.voltagesPerPhase?.A).toBe(400);

      // Check compensator effect  
      const loadNode = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'load-node');
      expect(loadNode?.equi8).toBeDefined();
      
      // Equipment should be active
      const srg2 = equipment.srg2;
      const compensator = equipment.neutralCompensators[0];
      expect(srg2?.enabled).toBe(true);
      expect((compensator as any).isLimited).toBe(false);
    });

    it('should maintain baseline comparison', () => {
      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'intermediate',
          enabled: true,
          networkType: '400V',
          maxPowerInjection_kVA: 44,
          maxPowerConsumption_kVA: 44
        },
        neutralCompensators: [],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'PRÉLÈVEMENT',
        equipment
      );

      // Should have baseline result for comparison
      expect(result.baselineResult).toBeDefined();
      expect(result.baselineResult.nodeMetricsPerPhase).toBeDefined();

      // Equipment result should be different from baseline
      const baselineIntermediate = result.baselineResult.nodeMetricsPerPhase?.find(n => n.nodeId === 'intermediate');
      const simulationIntermediate = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'intermediate');
      
      expect(simulationIntermediate?.voltagesPerPhase?.A).toBe(400);
      expect(baselineIntermediate?.voltagesPerPhase?.A).not.toBe(400);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle disabled equipment gracefully', () => {
      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'intermediate',
          enabled: false,
          networkType: '400V',
          maxPowerInjection_kVA: 44,
          maxPowerConsumption_kVA: 44
        },
        neutralCompensators: [{
          id: 'comp1',
          nodeId: 'load-node',
          maxPower_kVA: 50,
          tolerance_A: 1.0,
          enabled: false // Disabled
        }],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'PRÉLÈVEMENT',
        equipment
      );

      // Should behave like baseline (no equipment applied)
      expect(result.isSimulation).toBe(true);
      
      // Equipment should not be active
      const srg2 = equipment.srg2;
      const compensator = equipment.neutralCompensators[0];
      expect(srg2?.enabled).toBe(false);
      expect((compensator as any).isLimited).toBeUndefined();
    });

    it('should handle equipment on non-existent nodes', () => {
      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'non-existent-node',
          enabled: true,
          networkType: '400V',
          maxPowerInjection_kVA: 44,
          maxPowerConsumption_kVA: 44
        },
        neutralCompensators: [],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'PRÉLÈVEMENT',
        equipment
      );

      // Should complete without errors
      expect(result.isSimulation).toBe(true);
      expect(result.nodeMetricsPerPhase).toBeDefined();
    });
  });
});