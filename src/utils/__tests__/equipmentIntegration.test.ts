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
      description: 'Integration test project',
      voltageSystem: 'TÉTRAPHASÉ_400V',
      loadModel: 'monophase_reparti' as const,
      foisonnementCharges: 100,
      foisonnementProductions: 0,
      desequilibrePourcent: 0,
      transformerConfig: {
        power_kVA: 100,
        nominalVoltage_V: 400,
        type: 'TRI_400V'
      },
      nodes: [
        {
          id: 'source',
          name: 'Source',
          latitude: 0,
          longitude: 0,
          isSource: true,
          connectionType: 'TÉTRA_3P+N_230_400V' as const,
          clients: [],
          productions: []
        },
        {
          id: 'intermediate',
          name: 'Intermediate Node',
          latitude: 0.001,
          longitude: 0.001,
          isSource: false,
          connectionType: 'TÉTRA_3P+N_230_400V' as const,
          clients: [],
          productions: []
        },
        {
          id: 'load-node',
          name: 'Load Node',
          latitude: 0.002,
          longitude: 0.002,
          isSource: false,
          connectionType: 'TÉTRA_3P+N_230_400V' as const,
          clients: [{ S_kVA: 20, description: 'Test Load' }],
          productions: []
        }
      ],
      cables: [
        {
          id: 'cable1',
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
        name: 'Standard Cable',
        R12_ohm_per_km: 0.5,
        X12_ohm_per_km: 0.3,
        R0_ohm_per_km: 0.8,
        X0_ohm_per_km: 0.4,
        Imax_A: 100,
        price_euro_per_m: 15
      }]
    };
  });

  describe('Voltage Regulator Integration', () => {
    it('should apply voltage regulation and maintain downstream voltage levels', () => {
      const equipment: SimulationEquipment = {
        regulators: [{
          id: 'reg1',
          nodeId: 'intermediate',
          type: '400V_44kVA',
          targetVoltage_V: 400,
          maxPower_kVA: 44,
          enabled: true
        }],
        neutralCompensators: [],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'JOUR', 
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
        regulators: [
          {
            id: 'reg1',
            nodeId: 'intermediate',
            type: '400V_44kVA',
            targetVoltage_V: 380,
            maxPower_kVA: 44,
            enabled: true
          },
          {
            id: 'reg2',
            nodeId: 'load-node',
            type: '230V_77kVA',
            targetVoltage_V: 230,
            maxPower_kVA: 77,
            enabled: true
          }
        ],
        neutralCompensators: [],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'JOUR',
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
        { S_kVA: 10, description: 'Load Phase A' },
        { S_kVA: 5, description: 'Load Phase B' }, 
        { S_kVA: 15, description: 'Load Phase C' }
      ];
      mockProject.loadModel = 'triphase_desequilibre';
      mockProject.desequilibrePourcent = 30;

      const equipment: SimulationEquipment = {
        regulators: [],
        neutralCompensators: [{
          id: 'comp1',
          nodeId: 'load-node',
          maxPower_kVA: 50,
          enabled: true
        }],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'JOUR',
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
        { S_kVA: 8, description: 'Load A' },
        { S_kVA: 6, description: 'Load B' },
        { S_kVA: 10, description: 'Load C' }
      ];
      mockProject.desequilibrePourcent = 20;

      const equipment: SimulationEquipment = {
        regulators: [{
          id: 'reg1',
          nodeId: 'intermediate',
          type: '400V_44kVA',
          targetVoltage_V: 400,
          maxPower_kVA: 44,
          enabled: true
        }],
        neutralCompensators: [{
          id: 'comp1',
          nodeId: 'load-node',
          maxPower_kVA: 50,
          enabled: true
        }],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'JOUR',
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
      
      // Both should be active
      const regulator = equipment.regulators[0];
      const compensator = equipment.neutralCompensators[0];
      expect((regulator as any).isActive).toBe(true);
      expect((compensator as any).isLimited).toBe(false);
    });

    it('should maintain baseline comparison', () => {
      const equipment: SimulationEquipment = {
        regulators: [{
          id: 'reg1',
          nodeId: 'intermediate',
          type: '400V_44kVA',
          targetVoltage_V: 400,
          maxPower_kVA: 44,
          enabled: true
        }],
        neutralCompensators: [],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'JOUR',
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
        regulators: [{
          id: 'reg1',
          nodeId: 'intermediate',
          type: '400V_44kVA',
          targetVoltage_V: 400,
          maxPower_kVA: 44,
          enabled: false // Disabled
        }],
        neutralCompensators: [{
          id: 'comp1',
          nodeId: 'load-node',
          maxPower_kVA: 50,
          enabled: false // Disabled
        }],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'JOUR',
        equipment
      );

      // Should behave like baseline (no equipment applied)
      expect(result.isSimulation).toBe(true);
      
      // Equipment should not be active
      const regulator = equipment.regulators[0];
      const compensator = equipment.neutralCompensators[0];
      expect((regulator as any).isActive).toBeUndefined();
      expect((compensator as any).isLimited).toBeUndefined();
    });

    it('should handle equipment on non-existent nodes', () => {
      const equipment: SimulationEquipment = {
        regulators: [{
          id: 'reg1',
          nodeId: 'non-existent-node',
          type: '400V_44kVA',
          targetVoltage_V: 400,
          maxPower_kVA: 44,
          enabled: true
        }],
        neutralCompensators: [],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'JOUR',
        equipment
      );

      // Should complete without errors
      expect(result.isSimulation).toBe(true);
      expect(result.nodeMetricsPerPhase).toBeDefined();
    });
  });
});