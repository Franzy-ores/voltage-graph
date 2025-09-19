import { ElectricalCalculator } from '../electricalCalculations';
import { Node, Cable, CableType, VoltageRegulator, CalculationResult } from '@/types/network';
import { describe, it, expect, beforeEach } from 'vitest';

describe('Voltage Regulator Tests', () => {
  let calculator: ElectricalCalculator;
  let mockNodes: Node[];
  let mockCables: Cable[];
  let mockCableTypes: CableType[];
  let mockBaseResult: CalculationResult;

  beforeEach(() => {
    calculator = new ElectricalCalculator(0.95);

    // Mock cable type
    mockCableTypes = [{
      id: 'cable1',
      label: 'Test Cable',
      R12_ohm_per_km: 0.5,
      X12_ohm_per_km: 0.3,
      R0_ohm_per_km: 0.8,
      X0_ohm_per_km: 0.4,
      matiere: 'CUIVRE',
      posesPermises: ['SOUTERRAIN'],
      maxCurrent_A: 100
    }];

    // Mock nodes
    mockNodes = [
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
        id: 'regulator-node',
        name: 'Regulator Node',
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
        clients: [{ id: 'load1', label: 'Test Load', S_kVA: 10 }],
        productions: []
      }
    ];

    // Mock cables
    mockCables = [
      {
        id: 'cable1',
        name: 'Cable 1',
        pose: 'SOUTERRAIN',
        nodeAId: 'source',
        nodeBId: 'regulator-node',
        typeId: 'cable1',
        coordinates: [
          { lat: 0, lng: 0 },
          { lat: 0.001, lng: 0.001 }
        ]
      },
      {
        id: 'cable2',
        name: 'Cable 2',
        pose: 'SOUTERRAIN',
        nodeAId: 'regulator-node',
        nodeBId: 'load-node',
        typeId: 'cable1',
        coordinates: [
          { lat: 0.001, lng: 0.001 },
          { lat: 0.002, lng: 0.002 }
        ]
      }
    ];

    // Mock base result
    mockBaseResult = {
      scenario: 'PRÉLÈVEMENT',
      cables: mockCables,
      totalLoads_kVA: 10,
      totalProductions_kVA: 0,
      globalLosses_kW: 0,
      maxVoltageDropPercent: 2.5,
      compliance: 'normal',
      nodeMetricsPerPhase: [
        {
          nodeId: 'source',
          voltagesPerPhase: { A: 400, B: 400, C: 400 },
          voltageDropsPerPhase: { A: 0, B: 0, C: 0 },
          currentPerPhase: { A: 0, B: 0, C: 0 },
          powerPerPhase: { A: 0, B: 0, C: 0 }
        },
        {
          nodeId: 'regulator-node',
          voltagesPerPhase: { A: 395, B: 395, C: 395 },
          voltageDropsPerPhase: { A: 5, B: 5, C: 5 },
          currentPerPhase: { A: 5, B: 5, C: 5 },
          powerPerPhase: { A: 1975, B: 1975, C: 1975 }
        },
        {
          nodeId: 'load-node',
          voltagesPerPhase: { A: 390, B: 390, C: 390 },
          voltageDropsPerPhase: { A: 10, B: 10, C: 10 },
          currentPerPhase: { A: 10, B: 10, C: 10 },
          powerPerPhase: { A: 3900, B: 3900, C: 3900 }
        }
      ],
      virtualBusbar: {
        voltage_V: 400,
        current_A: 0,
        netSkVA: 0,
        deltaU_V: 0,
        deltaU_percent: 0,
        losses_kW: 0,
        circuits: []
      }
    };
  });

  describe('Voltage Regulator at 230V', () => {
    it('should regulate voltage to 230V target and verify downstream nodes', () => {
      const regulator: VoltageRegulator = {
        id: 'reg1',
        nodeId: 'regulator-node',
        type: '230V_77kVA',
        targetVoltage_V: 230,
        maxPower_kVA: 77,
        enabled: true
      };

      const result = calculator.applyVoltageRegulators(
        mockNodes,
        mockCables,
        [regulator],
        mockBaseResult,
        mockCableTypes
      );

      // Check regulator node voltage is set to target
      const regulatorNodeResult = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'regulator-node');
      expect(regulatorNodeResult?.voltagesPerPhase?.A).toBe(230);
      expect(regulatorNodeResult?.voltagesPerPhase?.B).toBe(230);
      expect(regulatorNodeResult?.voltagesPerPhase?.C).toBe(230);

      // Check downstream voltage is bounded around 230V (with voltage drop)
      const loadNodeResult = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'load-node');
      expect(loadNodeResult?.voltagesPerPhase?.A).toBeGreaterThan(220);
      expect(loadNodeResult?.voltagesPerPhase?.A).toBeLessThan(230);

      // Check regulator status
      expect((regulator as any).isActive).toBe(true);
      expect((regulator as any).actualVoltage_V).toBe(230);
    });

    it('should regulate voltage to 400V target and verify downstream nodes', () => {
      const regulator: VoltageRegulator = {
        id: 'reg1',
        nodeId: 'regulator-node',
        type: '400V_44kVA',
        targetVoltage_V: 400,
        maxPower_kVA: 44,
        enabled: true
      };

      const result = calculator.applyVoltageRegulators(
        mockNodes,
        mockCables,
        [regulator],
        mockBaseResult,
        mockCableTypes
      );

      // Check regulator node voltage is set to target
      const regulatorNodeResult = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'regulator-node');
      expect(regulatorNodeResult?.voltagesPerPhase?.A).toBe(400);
      expect(regulatorNodeResult?.voltagesPerPhase?.B).toBe(400);
      expect(regulatorNodeResult?.voltagesPerPhase?.C).toBe(400);

      // Check downstream voltage is bounded around 400V (with voltage drop)
      const loadNodeResult = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'load-node');
      expect(loadNodeResult?.voltagesPerPhase?.A).toBeGreaterThan(390);
      expect(loadNodeResult?.voltagesPerPhase?.A).toBeLessThan(400);
    });
  });

  describe('No Regulator Behavior', () => {
    it('should maintain original behavior without regulators', () => {
      const result = calculator.applyVoltageRegulators(
        mockNodes,
        mockCables,
        [],
        mockBaseResult,
        mockCableTypes
      );

      // Result should be unchanged
      expect(result).toEqual(mockBaseResult);
    });
  });

  describe('Power Limit Tests', () => {
    it('should respect power limits based on downstream load', () => {
      // Add high load downstream
      mockNodes[2].clients = [{ id: 'high-load', label: 'High Load', S_kVA: 100 }]; // 100kVA load

      const regulator: VoltageRegulator = {
        id: 'reg1',
        nodeId: 'regulator-node',
        type: '400V_44kVA',  // Only 44kVA capacity
        targetVoltage_V: 400,
        maxPower_kVA: 44,    // Less than downstream load
        enabled: true
      };

      const result = calculator.applyVoltageRegulators(
        mockNodes,
        mockCables,
        [regulator],
        mockBaseResult,
        mockCableTypes
      );

      // Regulator should be limited due to insufficient capacity
      expect((regulator as any).isLimited).toBe(true);
      expect((regulator as any).limitReason).toBeDefined();
      
      // Voltage should not be regulated (regulator disabled)
      const regulatorNodeResult = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'regulator-node');
      expect(regulatorNodeResult?.voltagesPerPhase?.A).toBe(395); // Original voltage
    });
  });

  describe('Integration Tests', () => {
    it('should maintain consistent voltage propagation', () => {
      const regulator: VoltageRegulator = {
        id: 'reg1',
        nodeId: 'regulator-node',
        type: '230V_77kVA',
        targetVoltage_V: 230,
        maxPower_kVA: 77,
        enabled: true
      };

      const result = calculator.applyVoltageRegulators(
        mockNodes,
        mockCables,
        [regulator],
        mockBaseResult,
        mockCableTypes
      );

      // Verify voltage progression is logical
      const sourceVoltage = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'source')?.voltagesPerPhase?.A || 0;
      const regulatorVoltage = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'regulator-node')?.voltagesPerPhase?.A || 0;
      const loadVoltage = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'load-node')?.voltagesPerPhase?.A || 0;

      // Regulator should be at target
      expect(regulatorVoltage).toBe(230);
      
      // Load voltage should be less than regulator voltage (voltage drop)
      expect(loadVoltage).toBeLessThanOrEqual(regulatorVoltage);
      
      // All voltages should be reasonable
      expect(loadVoltage).toBeGreaterThan(200);
      expect(loadVoltage).toBeLessThan(250);
    });
  });
});
