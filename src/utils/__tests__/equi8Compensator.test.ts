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
      name: 'Test Cable',
      R12_ohm_per_km: 0.2,
      X12_ohm_per_km: 0.1,
      R0_ohm_per_km: 0.2,
      X0_ohm_per_km: 0.1,
      Imax_A: 100,
      price_euro_per_m: 10
    }];

    mockNodes = [{
      id: 'test-node',
      name: 'Test Node',
      latitude: 0,
      longitude: 0,
      isSource: false,
      connectionType: 'TÉTRA_3P+N_230_400V' as const,
      clients: [{ S_kVA: 5, name: 'Test Load' }],
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

      // Verify calculation components
      expect(result.dU_init).toBe(4); // 231 - 227
      expect(result.dU_EQUI8).toBeLessThan(result.dU_init); // Should be reduced
      expect(result.ratios.length).toBe(3);
    });

    it('should handle balanced voltages', () => {
      const Uinit: [number, number, number] = [230, 230, 230];
      const Zph = 0.2;
      const Zn = 0.2;

      const result = calculator.computeEqui8(Uinit, Zph, Zn);

      // Should remain balanced
      expect(result.UEQUI8[0]).toBeCloseTo(230, 1);
      expect(result.UEQUI8[1]).toBeCloseTo(230, 1);
      expect(result.UEQUI8[2]).toBeCloseTo(230, 1);
      expect(result.I_EQUI8).toBeCloseTo(0, 1);
      expect(result.dU_init).toBe(0);
    });

    it('should warn for impedances outside validity domain', () => {
      const Uinit: [number, number, number] = [231, 229, 227];
      const Zph = 0.1; // Below 0.15Ω
      const Zn = 0.1;

      const result = calculator.computeEqui8(Uinit, Zph, Zn);

      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('hors domaine');
    });
  });

  describe('Neutral Compensator Integration Tests', () => {
    it('should apply EQUI8 in supplier mode (post-processing)', () => {
      const compensator: NeutralCompensator = {
        id: 'comp1',
        nodeId: 'test-node',
        maxPower_kVA: 50,
        tolerance_A: 5,
        enabled: true
        // applyToFlow default = false (supplier mode)
      };

      const mockBaseResult: CalculationResult = {
        nodeMetrics: [],
        nodeMetricsPerPhase: [{
          nodeId: 'test-node',
          voltagesPerPhase: { A: 231, B: 229, C: 227 },
          currentPerPhase: { A: 10, B: 10, C: 10 },
          powerPerPhase: { A: 2310, B: 2290, C: 2270 }
        }],
        cableResults: [],
        nodeVoltageDrops: [],
        virtualBusbar: {
          voltage_V: 230,
          current_A: 10,
          netSkVA: 5,
          deltaU_V: 0,
          deltaU_percent: 0,
          losses_kW: 0,
          circuits: []
        },
        totalLosses_kW: 0,
        summary: {
          totalLoad_kVA: 5,
          totalProduction_kVA: 0,
          netBalance_kVA: 5,
          averageVoltage_V: 229,
          minVoltage_V: 227,
          maxVoltage_V: 231,
          voltageSpread_percent: 1.75,
          totalLosses_kW: 0,
          efficiency_percent: 100
        }
      };

      const result = calculator.applyNeutralCompensation(
        mockNodes,
        mockCables,
        [compensator],
        mockBaseResult,
        mockCableTypes
      );

      // Check EQUI8 results are stored
      const nodeResult = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'test-node');
      expect(nodeResult?.equi8).toBeDefined();
      expect(nodeResult?.equi8?.UEQUI8).toBeDefined();
      expect(nodeResult?.equi8?.I_EQUI8).toBeDefined();

      // Original voltages should be unchanged in supplier mode
      expect(nodeResult?.voltagesPerPhase?.A).toBe(231);
      expect(nodeResult?.voltagesPerPhase?.B).toBe(229);
      expect(nodeResult?.voltagesPerPhase?.C).toBe(227);

      // Compensator status should be updated
      expect((compensator as any).currentIN_A).toBeGreaterThan(0);
      expect((compensator as any).reductionPercent).toBeGreaterThan(0);
    });

    it('should apply EQUI8 in integrated mode (applyToFlow=true)', () => {
      const compensator: NeutralCompensator = {
        id: 'comp1',
        nodeId: 'test-node',
        maxPower_kVA: 50,
        enabled: true,
        applyToFlow: true // Integrated mode
      } as any;

      const mockBaseResult: CalculationResult = {
        nodeMetrics: [],
        nodeMetricsPerPhase: [{
          nodeId: 'test-node',
          voltagesPerPhase: { A: 231, B: 229, C: 227 },
          currentPerPhase: { A: 10, B: 10, C: 10 },
          powerPerPhase: { A: 2310, B: 2290, C: 2270 }
        }],
        cableResults: [],
        nodeVoltageDrops: [],
        virtualBusbar: {
          voltage_V: 230,
          current_A: 10,
          netSkVA: 5,
          deltaU_V: 0,
          deltaU_percent: 0,
          losses_kW: 0,
          circuits: []
        },
        totalLosses_kW: 0,
        summary: {
          totalLoad_kVA: 5,
          totalProduction_kVA: 0,
          netBalance_kVA: 5,
          averageVoltage_V: 229,
          minVoltage_V: 227,
          maxVoltage_V: 231,
          voltageSpread_percent: 1.75,
          totalLosses_kW: 0,
          efficiency_percent: 100
        }
      };

      const result = calculator.applyNeutralCompensation(
        mockNodes,
        mockCables,
        [compensator],
        mockBaseResult,
        mockCableTypes
      );

      // In integrated mode, voltages should be modified
      const nodeResult = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'test-node');
      expect(nodeResult?.voltagesPerPhase?.A).not.toBe(231); // Should be different
      expect(nodeResult?.voltagesPerPhase?.B).not.toBe(229);
      expect(nodeResult?.voltagesPerPhase?.C).not.toBe(227);

      // Voltages should be more balanced
      const { A, B, C } = nodeResult?.voltagesPerPhase || { A: 0, B: 0, C: 0 };
      const newSpread = Math.max(A, B, C) - Math.min(A, B, C);
      expect(newSpread).toBeLessThan(4); // Original spread was 4V
    });

    it('should respect kVA limits and prevent overload', () => {
      // High downstream load
      mockNodes[0].clients = [{ S_kVA: 100, description: 'High Load' }];

      const compensator: NeutralCompensator = {
        id: 'comp1',
        nodeId: 'test-node',
        maxPower_kVA: 50, // Less than downstream load
        enabled: true
      };

      const mockBaseResult: CalculationResult = {
        nodeMetrics: [],
        nodeMetricsPerPhase: [{
          nodeId: 'test-node',
          voltagesPerPhase: { A: 231, B: 229, C: 227 },
          currentPerPhase: { A: 10, B: 10, C: 10 },
          powerPerPhase: { A: 2310, B: 2290, C: 2270 }
        }],
        cableResults: [],
        nodeVoltageDrops: [],
        virtualBusbar: {
          voltage_V: 230,
          current_A: 10,
          netSkVA: 100,
          deltaU_V: 0,
          deltaU_percent: 0,
          losses_kW: 0,
          circuits: []
        },
        totalLosses_kW: 0,
        summary: {
          totalLoad_kVA: 100,
          totalProduction_kVA: 0,
          netBalance_kVA: 100,
          averageVoltage_V: 229,
          minVoltage_V: 227,
          maxVoltage_V: 231,
          voltageSpread_percent: 1.75,
          totalLosses_kW: 0,
          efficiency_percent: 100
        }
      };

      const result = calculator.applyNeutralCompensation(
        mockNodes,
        mockCables,
        [compensator],
        mockBaseResult,
        mockCableTypes
      );

      // Compensator should be limited
      expect((compensator as any).isLimited).toBe(true);
      expect((compensator as any).overloadReason).toBeDefined();
      expect((compensator as any).currentIN_A).toBe(0);
      expect((compensator as any).reductionPercent).toBe(0);

      // Voltages should be unchanged
      const nodeResult = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'test-node');
      expect(nodeResult?.voltagesPerPhase?.A).toBe(231);
      expect(nodeResult?.voltagesPerPhase?.B).toBe(229);
      expect(nodeResult?.voltagesPerPhase?.C).toBe(227);
    });
  });

  describe('Robustness Tests', () => {
    it('should handle missing node data gracefully', () => {
      const compensator: NeutralCompensator = {
        id: 'comp1',
        nodeId: 'nonexistent-node',
        maxPower_kVA: 50,
        enabled: true
      };

      const mockBaseResult: CalculationResult = {
        nodeMetrics: [],
        nodeMetricsPerPhase: [],
        cableResults: [],
        nodeVoltageDrops: [],
        virtualBusbar: {
          voltage_V: 230,
          current_A: 0,
          netSkVA: 0,
          deltaU_V: 0,
          deltaU_percent: 0,
          losses_kW: 0,
          circuits: []
        },
        totalLosses_kW: 0,
        summary: {
          totalLoad_kVA: 0,
          totalProduction_kVA: 0,
          netBalance_kVA: 0,
          averageVoltage_V: 230,
          minVoltage_V: 230,
          maxVoltage_V: 230,
          voltageSpread_percent: 0,
          totalLosses_kW: 0,
          efficiency_percent: 100
        }
      };

      const result = calculator.applyNeutralCompensation(
        mockNodes,
        mockCables,
        [compensator],
        mockBaseResult,
        mockCableTypes
      );

      // Should return original result unchanged
      expect(result).toEqual(mockBaseResult);
    });

    it('should skip compensation for already balanced voltages', () => {
      const compensator: NeutralCompensator = {
        id: 'comp1',
        nodeId: 'test-node',
        maxPower_kVA: 50,
        enabled: true
      };

      const mockBaseResult: CalculationResult = {
        nodeMetrics: [],
        nodeMetricsPerPhase: [{
          nodeId: 'test-node',
          voltagesPerPhase: { A: 230, B: 230, C: 230 }, // Already balanced
          currentPerPhase: { A: 10, B: 10, C: 10 },
          powerPerPhase: { A: 2300, B: 2300, C: 2300 }
        }],
        cableResults: [],
        nodeVoltageDrops: [],
        virtualBusbar: {
          voltage_V: 230,
          current_A: 10,
          netSkVA: 5,
          deltaU_V: 0,
          deltaU_percent: 0,
          losses_kW: 0,
          circuits: []
        },
        totalLosses_kW: 0,
        summary: {
          totalLoad_kVA: 5,
          totalProduction_kVA: 0,
          netBalance_kVA: 5,
          averageVoltage_V: 230,
          minVoltage_V: 230,
          maxVoltage_V: 230,
          voltageSpread_percent: 0,
          totalLosses_kW: 0,
          efficiency_percent: 100
        }
      };

      const result = calculator.applyNeutralCompensation(
        mockNodes,
        mockCables,
        [compensator],
        mockBaseResult,
        mockCableTypes
      );

      // Should skip compensation
      expect((compensator as any).currentIN_A).toBe(0);
      expect((compensator as any).reductionPercent).toBe(0);

      // Voltages should remain unchanged
      const nodeResult = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'test-node');
      expect(nodeResult?.voltagesPerPhase?.A).toBe(230);
      expect(nodeResult?.voltagesPerPhase?.B).toBe(230);
      expect(nodeResult?.voltagesPerPhase?.C).toBe(230);
    });
  });
});
