import { describe, it, expect, beforeEach } from 'vitest';
import { SimulationCalculator } from '@/utils/simulationCalculator';
import { ElectricalCalculator } from '@/utils/electricalCalculations';
import type { Project, SimulationEquipment, Node, Cable } from '@/types/network';
import { defaultCableTypes } from '@/data/defaultCableTypes';

describe('Equipment Integration Tests', () => {
  let calculator: SimulationCalculator;
  let electricalCalculator: ElectricalCalculator;
  let mockProject: Project;

  beforeEach(() => {
    calculator = new SimulationCalculator();
    electricalCalculator = new ElectricalCalculator();
    mockProject = {
      id: 'test-project',
      name: 'Integration Test Project',
      voltageSystem: "TÉTRAPHASÉ_400V",
      cosPhi: 0.95,
      foisonnementCharges: 100,
      foisonnementProductions: 100,
      defaultChargeKVA: 10,
      defaultProductionKVA: 5,
      transformerConfig: {
        rating: "160kVA",
        nominalPower_kVA: 160,
        nominalVoltage_V: 400,
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
          name: 'Source',
          lat: 46.6167,
          lng: 6.8833,
          connectionType: "TÉTRA_3P+N_230_400V",
          clients: [],
          productions: [],
          isSource: true
        },
        {
          id: 'intermediate',
          name: 'Intermediate Node',
          lat: 46.6170,
          lng: 6.8835,
          connectionType: "TÉTRA_3P+N_230_400V",
          clients: [{ id: 'client1', label: 'Client 1', S_kVA: 15 }],
          productions: [{ id: 'prod1', label: 'PV 1', S_kVA: 8 }],
          isSource: false
        },
        {
          id: 'end-node',
          name: 'End Node',
          lat: 46.6175,
          lng: 6.8840,
          connectionType: "TÉTRA_3P+N_230_400V",
          clients: [{ id: 'client2', label: 'Client 2', S_kVA: 20 }],
          productions: [],
          isSource: false
        }
      ] as Node[],
      cables: [
        {
          id: 'cable1',
          name: 'Cable 1',
          typeId: 'baxb-95',
          pose: "AÉRIEN",
          nodeAId: 'source',
          nodeBId: 'intermediate',
          coordinates: [
            { lat: 46.6167, lng: 6.8833 },
            { lat: 46.6170, lng: 6.8835 }
          ],
          length_m: 50
        },
        {
          id: 'cable2',
          name: 'Cable 2',
          typeId: 'baxb-70',
          pose: "AÉRIEN",
          nodeAId: 'intermediate',
          nodeBId: 'end-node',
          coordinates: [
            { lat: 46.6170, lng: 6.8835 },
            { lat: 46.6175, lng: 6.8840 }
          ],
          length_m: 75
        }
      ] as Cable[],
      cableTypes: defaultCableTypes
    };
  });

  describe('Multi-equipment Simulation', () => {
    it('should handle combined SRG2 and neutral compensator simulation', () => {
      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'intermediate',
          enabled: true
        },
        neutralCompensators: [{
          id: 'comp1',
          nodeId: 'end-node',
          enabled: true,
          maxPower_kVA: 50,
          tolerance_A: 5.0,
          phaseImpedance: 0.5,
          neutralImpedance: 0.1
        }],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'PRÉLÈVEMENT', 
        equipment
      );

      expect(result).toBeDefined();
      expect(result.isSimulation).toBe(true);
      expect(result.equipment).toEqual(equipment);
    });
  });

  describe('Voltage Regulator Integration', () => {
    it('should apply voltage regulation and maintain downstream voltage levels', () => {
      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'intermediate',
          enabled: true
        },
        neutralCompensators: [],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'PRÉLÈVEMENT', 
        equipment
      );

      expect(result).toBeDefined();
      expect(result.isSimulation).toBe(true);
      
      // Vérifier que la simulation a été appliquée
      const srg2Result = result.srg2Result;
      expect(srg2Result).toBeDefined();
      expect(srg2Result?.nodeId).toBe('intermediate');
    });

    it('should calculate baseline and simulation results separately', () => {
      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'intermediate',
          enabled: true
        },
        neutralCompensators: [],
        cableUpgrades: []
      };

      const simulationResult = calculator.calculateWithSimulation(
        mockProject,
        'MIXTE',
        equipment
      );

      const baselineResult = electricalCalculator.calculateScenario(
        mockProject,
        'MIXTE'
      );

      expect(simulationResult).toBeDefined();
      expect(baselineResult).toBeDefined();
      expect(simulationResult.baselineResult).toBeDefined();
      
      // Les résultats peuvent être différents après application de l'équipement
      expect(simulationResult.isSimulation).toBe(true);
      expect(baselineResult.scenario).toBe('MIXTE');
    });

    it('should handle equipment on multiple nodes', () => {
      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'intermediate',
          enabled: true
        },
        neutralCompensators: [{
          id: 'comp1',
          nodeId: 'end-node',
          enabled: true,
          maxPower_kVA: 30,
          tolerance_A: 3.0,
          phaseImpedance: 0.4,
          neutralImpedance: 0.08
        }],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'PRODUCTION',
        equipment
      );

      expect(result).toBeDefined();
      expect(result.isSimulation).toBe(true);
      expect(result.equipment?.neutralCompensators).toHaveLength(1);
      expect(result.equipment?.neutralCompensators[0].nodeId).toBe('end-node');
    });

    it('should handle cable upgrades in combination with other equipment', () => {
      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'intermediate',
          enabled: true
        },
        neutralCompensators: [],
        cableUpgrades: [{
          originalCableId: 'cable2',
          newCableTypeId: 'baxb-150',
          reason: 'voltage_drop',
          before: { voltageDropPercent: 12, current_A: 45, losses_kW: 2.1 },
          after: { voltageDropPercent: 8, current_A: 45, losses_kW: 1.3 },
          improvement: { voltageDropReduction: 4, lossReduction_kW: 0.8, lossReductionPercent: 38 }
        }]
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'PRÉLÈVEMENT',
        equipment
      );

      expect(result).toBeDefined();
      expect(result.isSimulation).toBe(true);
      expect(result.equipment?.cableUpgrades).toHaveLength(1);
    });

    it('should handle disabled equipment correctly', () => {
      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'intermediate',
          enabled: false
        },
        neutralCompensators: [{
          id: 'comp1',
          nodeId: 'end-node',
          enabled: false,
          maxPower_kVA: 25,
          tolerance_A: 2.0,
          phaseImpedance: 0.3,
          neutralImpedance: 0.06
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
      
      // Avec les équipements désactivés, les résultats devraient être similaires au baseline
      const baseline = result.baselineResult;
      expect(baseline).toBeDefined();
      
      // Vérifier que les équipements désactivés n'ont pas d'effet significatif
      expect(Math.abs(result.globalLosses_kW - (baseline?.globalLosses_kW || 0))).toBeLessThan(0.1);
    });

    it('should handle non-existent nodes gracefully', () => {
      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'non-existent-node',
          enabled: true
        },
        neutralCompensators: [],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'PRÉLÈVEMENT',
        equipment
      );

      expect(result).toBeDefined();
      expect(result.isSimulation).toBe(true);
      
      // Même avec un nœud inexistant, le calcul devrait réussir
      // mais sans appliquer l'équipement
      expect(result.baselineResult).toBeDefined();
    });
  });

  describe('Equipment Validation', () => {
    it('should validate equipment configuration before applying', () => {
      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'source', // Les sources ne peuvent pas avoir de régulateur
          enabled: true
        },
        neutralCompensators: [],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'PRÉLÈVEMENT',
        equipment
      );

      expect(result).toBeDefined();
      expect(result.isSimulation).toBe(true);
    });

    it('should handle equipment conflicts appropriately', () => {
      const equipment: SimulationEquipment = {
        srg2: {
          nodeId: 'intermediate',
          enabled: true
        },
        neutralCompensators: [{
          id: 'comp1',
          nodeId: 'intermediate', // Même nœud que le régulateur
          enabled: true,
          maxPower_kVA: 40,
          tolerance_A: 4.0,
          phaseImpedance: 0.6,
          neutralImpedance: 0.12
        }],
        cableUpgrades: []
      };

      const result = calculator.calculateWithSimulation(
        mockProject,
        'PRÉLÈVEMENT',
        equipment
      );

      expect(result).toBeDefined();
      expect(result.isSimulation).toBe(true);
      
      // Le système devrait gérer les conflits d'équipement gracieusement
      expect(result.equipment).toEqual(equipment);
    });
  });
});