import { ElectricalCalculator } from '../electricalCalculations';
import { Node, Cable, CableType, NeutralCompensator, CalculationResult } from '@/types/network';
import { describe, it, expect, beforeEach } from 'vitest';

describe('EQUI8 Compensator Tests', () => {
  let calculator: ElectricalCalculator;
  let mockNodes: Node[];
  let mockCables: Cable[];
  let mockCableTypes: CableType[];

  beforeEach(() => {
    calculator = new ElectricalCalculator(0.95);

    // Mock cable type
    mockCableTypes = [{
      id: 'cable1',
      label: 'Test Cable',
      R12_ohm_per_km: 0.2,
      X12_ohm_per_km: 0.1,
      R0_ohm_per_km: 0.2,
      X0_ohm_per_km: 0.1,
      matiere: 'CUIVRE',
      posesPermises: ['SOUTERRAIN'],
      maxCurrent_A: 100
    }];

    mockNodes = [{
      id: 'test-node',
      name: 'Test Node',
      lat: 0,
      lng: 0,
      isSource: false,
      connectionType: 'TÉTRA_3P+N_230_400V' as const,
      clients: [{ id: 'load1', label: 'Test Load', S_kVA: 5 }],
      productions: []
    }];

    mockCables = [];
  });

  describe('computeEqui8 Unit Tests', () => {
    it('should compute EQUI8 with reference values', () => {
      const Uinit: [number, number, number] = [231, 229, 227];
      const Zph = 0.2;
      const Zn = 0.2;

      const result = calculator.computeEqui8(Uinit, Zph, Zn);

      // Expected results based on EQUI8 formulas
      expect(result.UEQUI8[0]).toBeCloseTo(229.83, 1);
      expect(result.UEQUI8[1]).toBeCloseTo(229.0, 1);
      expect(result.UEQUI8[2]).toBeCloseTo(228.16, 1);
      expect(result.I_EQUI8).toBeCloseTo(5.7, 1);
    });

    it('should handle edge case with very low impedances', () => {
      const Uinit: [number, number, number] = [230, 230, 230];
      const Zph = 0.1; // Below 0.15 threshold
      const Zn = 0.1;

      // Should still compute but might issue warning
      const result = calculator.computeEqui8(Uinit, Zph, Zn);
      
      expect(result.UEQUI8).toBeDefined();
      expect(result.I_EQUI8).toBeDefined();
    });

    it('should handle balanced voltages', () => {
      const Uinit: [number, number, number] = [230, 230, 230];
      const Zph = 0.3;
      const Zn = 0.3;

      const result = calculator.computeEqui8(Uinit, Zph, Zn);
      
      // With balanced input, should have minimal correction
      expect(result.UEQUI8[0]).toBeCloseTo(230, 1);
      expect(result.UEQUI8[1]).toBeCloseTo(230, 1);
      expect(result.UEQUI8[2]).toBeCloseTo(230, 1);
      expect(result.I_EQUI8).toBeCloseTo(0, 1);
    });
  });

  describe('Supplier Mode (applyToFlow=false)', () => {
    it('should compute EQUI8 without affecting network calculation', () => {
      const mockResult: CalculationResult = {
        scenario: 'PRÉLÈVEMENT',
        cables: [],
        totalLoads_kVA: 15,
        totalProductions_kVA: 0,
        globalLosses_kW: 0,
        maxVoltageDropPercent: 5,
        compliance: 'normal',
        nodeMetricsPerPhase: [
          {
            nodeId: 'load-node',
            voltagesPerPhase: { A: 231, B: 229, C: 227 },
            voltageDropsPerPhase: { A: 9, B: 11, C: 13 },
            currentPerPhase: { A: 10, B: 12, C: 14 },
            powerPerPhase: { A: 2310, B: 2748, C: 3178 }
          }
        ]
      };

      const compensator: NeutralCompensator = {
        id: 'comp1',
        nodeId: 'load-node',
        maxPower_kVA: 50,
        tolerance_A: 1.0,
        enabled: true
      };

      const result = calculator.applyNeutralCompensation(
        mockNodes,
        mockCables,
        [compensator],
        mockResult,
        mockCableTypes
      );

      // Check EQUI8 results are added to node
      const loadNode = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'load-node');
      expect(loadNode?.equi8).toBeDefined();
      expect(loadNode?.equi8?.UEQUI8).toBeDefined();
      expect(loadNode?.equi8?.I_EQUI8).toBeDefined();

      // Original voltages should be unchanged (supplier mode)
      expect(loadNode?.voltagesPerPhase?.A).toBe(231);
      expect(loadNode?.voltagesPerPhase?.B).toBe(229);
      expect(loadNode?.voltagesPerPhase?.C).toBe(227);
    });

    it('should apply EQUI8 in integrated mode (applyToFlow=true)', () => {
      const mockResult: CalculationResult = {
        scenario: 'PRÉLÈVEMENT',
        cables: [],
        totalLoads_kVA: 15,
        totalProductions_kVA: 0,
        globalLosses_kW: 0,
        maxVoltageDropPercent: 5,
        compliance: 'normal',
        nodeMetricsPerPhase: [
          {
            nodeId: 'load-node',
            voltagesPerPhase: { A: 231, B: 229, C: 227 },
            voltageDropsPerPhase: { A: 9, B: 11, C: 13 },
            currentPerPhase: { A: 10, B: 12, C: 14 },
            powerPerPhase: { A: 2310, B: 2748, C: 3178 }
          }
        ]
      };

      const compensator: NeutralCompensator = {
        id: 'comp1',
        nodeId: 'load-node',
        maxPower_kVA: 50,
        tolerance_A: 1.0,
        enabled: true,
        phaseImpedance: 0.2,
        neutralImpedance: 0.2
      };

      // TODO: Implement applyToFlow=true mode when integrated
      const result = calculator.applyNeutralCompensation(
        mockNodes,
        mockCables,
        [compensator],
        mockResult,
        mockCableTypes
      );

      expect(result).toBeDefined();
    });
  });

  describe('Power Limit Tests', () => {
    it('should respect kVA power limits', () => {
      const mockResult: CalculationResult = {
        scenario: 'PRÉLÈVEMENT',
        cables: [],
        totalLoads_kVA: 100,
        totalProductions_kVA: 0,
        globalLosses_kW: 0,
        maxVoltageDropPercent: 10,
        compliance: 'warning',
        nodeMetricsPerPhase: [
          {
            nodeId: 'load-node',
            voltagesPerPhase: { A: 220, B: 215, C: 210 },
            voltageDropsPerPhase: { A: 20, B: 25, C: 30 },
            currentPerPhase: { A: 50, B: 60, C: 70 },
            powerPerPhase: { A: 11000, B: 12900, C: 14700 }
          }
        ]
      };

      const compensator: NeutralCompensator = {
        id: 'comp1',
        nodeId: 'load-node',
        maxPower_kVA: 5, // Insufficient capacity
        tolerance_A: 1.0,
        enabled: true
      };

      const result = calculator.applyNeutralCompensation(
        mockNodes,
        mockCables,
        [compensator],
        mockResult,
        mockCableTypes
      );

      // Check compensator is limited
      expect(compensator.isLimited).toBe(true);
      expect(compensator.overloadReason).toBeDefined();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle compensator on non-existent node', () => {
      const mockResult: CalculationResult = {
        scenario: 'PRÉLÈVEMENT',
        cables: [],
        totalLoads_kVA: 15,
        totalProductions_kVA: 0,
        globalLosses_kW: 0,
        maxVoltageDropPercent: 5,
        compliance: 'normal',
        nodeMetricsPerPhase: [
          {
            nodeId: 'load-node',
            voltagesPerPhase: { A: 231, B: 229, C: 227 },
            voltageDropsPerPhase: { A: 9, B: 11, C: 13 }
          }
        ]
      };

      const compensator: NeutralCompensator = {
        id: 'comp1',
        nodeId: 'non-existent-node',
        maxPower_kVA: 50,
        tolerance_A: 1.0,
        enabled: true
      };

      const result = calculator.applyNeutralCompensation(
        mockNodes,
        mockCables,
        [compensator],
        mockResult,
        mockCableTypes
      );

      // Should complete without errors
      expect(result.nodeMetricsPerPhase).toBeDefined();
    });

    it('should handle disabled compensator', () => {
      const mockResult: CalculationResult = {
        scenario: 'PRÉLÈVEMENT',
        cables: [],
        totalLoads_kVA: 15,
        totalProductions_kVA: 0,
        globalLosses_kW: 0,
        maxVoltageDropPercent: 5,
        compliance: 'normal',
        nodeMetricsPerPhase: [
          {
            nodeId: 'load-node',
            voltagesPerPhase: { A: 231, B: 229, C: 227 },
            voltageDropsPerPhase: { A: 9, B: 11, C: 13 },
            currentPerPhase: { A: 10, B: 12, C: 14 },
            powerPerPhase: { A: 2310, B: 2748, C: 3178 }
          }
        ]
      };

      const compensator: NeutralCompensator = {
        id: 'comp1',
        nodeId: 'load-node',
        maxPower_kVA: 50,
        tolerance_A: 1.0,
        enabled: false // Disabled
      };

      const result = calculator.applyNeutralCompensation(
        mockNodes,
        mockCables,
        [compensator],
        mockResult,
        mockCableTypes
      );

      // Result should be unchanged (no compensation applied)
      expect(result).toEqual(mockResult);
    });
  });
});
