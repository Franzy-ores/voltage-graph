import { SRG2Regulator } from '../SRG2Regulator';
import { Project, SRG2Config, CalculationResult, VoltageSystem, LoadModel } from '@/types/network';

describe('SRG2 Voltage Display and Regulation', () => {
  let srg2Regulator: SRG2Regulator;

  beforeEach(() => {
    srg2Regulator = new SRG2Regulator();
  });

  const createTestProject = (
    voltageSystem: VoltageSystem, 
    loadModel: LoadModel
  ): Project => ({
    id: 'test-project',
    name: 'Test Project',
    voltageSystem,
    loadModel,
    cosPhi: 0.95,
    foisonnementCharges: 100,
    foisonnementProductions: 100,
    defaultChargeKVA: 5,
    defaultProductionKVA: 5,
    transformerConfig: {
      rating: '160kVA',
      nominalPower_kVA: 160,
      nominalVoltage_V: voltageSystem === 'TRIPHASÉ_230V' ? 230 : 400,
      shortCircuitVoltage_percent: 4,
      cosPhi: 0.95
    },
    nodes: [
      {
        id: 'source-node',
        name: 'Source',
        lat: 0,
        lng: 0,
        connectionType: 'TÉTRA_3P+N_230_400V',
        clients: [],
        productions: [],
        isSource: true
      },
      {
        id: 'srg2-node',
        name: 'SRG2 Node',
        lat: 0.001,
        lng: 0.001,
        connectionType: 'MONO_230V_PN',
        clients: [{ id: 'client1', label: 'Client 1', S_kVA: 10 }],
        productions: []
      }
    ],
    cables: [],
    cableTypes: []
  });

  const createMockBaselineResult = (): CalculationResult => ({
    scenario: 'MIXTE',
    cables: [],
    totalLoads_kVA: 10,
    totalProductions_kVA: 0,
    globalLosses_kW: 0.1,
    maxVoltageDropPercent: 2.5,
    compliance: 'normal',
    nodeMetricsPerPhase: [
      {
        nodeId: 'srg2-node',
        voltagesPerPhase: { A: 215, B: 218, C: 220 }, // Low voltages requiring boost
        voltageDropsPerPhase: { A: -15, B: -12, C: -10 }
      }
    ]
  });

  describe('Network Type Detection', () => {
    test('should detect 230V monophase correctly', () => {
      const project = createTestProject('TRIPHASÉ_230V', 'monophase_reparti');
      const config: SRG2Config = { nodeId: 'srg2-node', enabled: true };
      const baselineResult = createMockBaselineResult();
      
      const result = srg2Regulator.apply(config, 215, project, baselineResult);
      
      expect(result.networkType).toBe('230V_MONO');
      expect(result.state).toBe('BO2'); // Should trigger strong boost for 215V
      expect(result.ratio).toBe(1.075); // +7.5% boost
    });

    test('should detect 230V polyphase correctly', () => {
      const project = createTestProject('TRIPHASÉ_230V', 'polyphase_equilibre');
      const config: SRG2Config = { nodeId: 'srg2-node', enabled: true };
      const baselineResult = createMockBaselineResult();
      
      const result = srg2Regulator.apply(config, 215, project, baselineResult);
      
      expect(result.networkType).toBe('230V_POLY');
      expect(result.state).toBe('BO2');
      expect(result.ratio).toBe(1.075);
    });

    test('should detect 400V monophase correctly', () => {
      const project = createTestProject('TÉTRAPHASÉ_400V', 'monophase_reparti');
      const config: SRG2Config = { nodeId: 'srg2-node', enabled: true };
      const baselineResult = createMockBaselineResult();
      
      // Test with 400V monophase low voltage
      const result = srg2Regulator.apply(config, 365, project, baselineResult);
      
      expect(result.networkType).toBe('400V_MONO');
      expect(result.state).toBe('BO2'); // Should trigger boost for 365V (400V * 0.9125)
      expect(result.ratio).toBe(1.075);
    });

    test('should detect 400V polyphase correctly', () => {
      const project = createTestProject('TÉTRAPHASÉ_400V', 'polyphase_equilibre');
      const config: SRG2Config = { nodeId: 'srg2-node', enabled: true };
      const baselineResult = createMockBaselineResult();
      
      const result = srg2Regulator.apply(config, 215, project, baselineResult);
      
      expect(result.networkType).toBe('400V_POLY');
      expect(result.state).toBe('BO2');
      expect(result.ratio).toBe(1.075);
    });
  });

  describe('Voltage Regulation States', () => {
    test('should apply correct regulation ratios for different voltage levels', () => {
      const project = createTestProject('TRIPHASÉ_230V', 'monophase_reparti');
      const config: SRG2Config = { nodeId: 'srg2-node', enabled: true };
      const baselineResult = createMockBaselineResult();

      // Test strong boost (BO2)
      let result = srg2Regulator.apply(config, 205, project, baselineResult);
      expect(result.state).toBe('BO2');
      expect(result.ratio).toBe(1.075);

      // Test light boost (BO1)
      result = srg2Regulator.apply(config, 215, project, baselineResult);
      expect(result.state).toBe('BO2'); // Still BO2 at 215V

      result = srg2Regulator.apply(config, 218, project, baselineResult);
      expect(result.state).toBe('BO1');
      expect(result.ratio).toBe(1.0375);

      // Test normal (BYP)
      result = srg2Regulator.apply(config, 230, project, baselineResult);
      expect(result.state).toBe('BYP');
      expect(result.ratio).toBe(1.0);

      // Test light reduction (LO1)
      result = srg2Regulator.apply(config, 242, project, baselineResult);
      expect(result.state).toBe('LO1');
      expect(result.ratio).toBe(0.9625);

      // Test strong reduction (LO2)
      result = srg2Regulator.apply(config, 252, project, baselineResult);
      expect(result.state).toBe('LO2');
      expect(result.ratio).toBe(0.925);
    });
  });

  describe('Voltage Calculation Per Phase', () => {
    test('should apply regulation to all phases in monophase distributed mode', () => {
      const project = createTestProject('TRIPHASÉ_230V', 'monophase_reparti');
      const config: SRG2Config = { nodeId: 'srg2-node', enabled: true };
      const baselineResult = createMockBaselineResult();
      
      const result = srg2Regulator.apply(config, 215, project, baselineResult);
      
      expect(result.regulatedVoltages).toEqual({
        A: 215 * 1.075,
        B: 215 * 1.075,
        C: 215 * 1.075
      });
      
      expect(result.phaseRatios).toEqual({
        A: 1.075,
        B: 1.075,
        C: 1.075
      });
    });

    test('should apply uniform regulation in balanced polyphase mode', () => {
      const project = createTestProject('TRIPHASÉ_230V', 'polyphase_equilibre');
      const config: SRG2Config = { nodeId: 'srg2-node', enabled: true };
      const baselineResult = createMockBaselineResult();
      
      const result = srg2Regulator.apply(config, 215, project, baselineResult);
      
      const expectedVoltage = 215 * 1.075;
      expect(result.regulatedVoltages).toEqual({
        A: expectedVoltage,
        B: expectedVoltage,
        C: expectedVoltage
      });
    });
  });

  describe('Power Calculations', () => {
    test('should calculate downstream power correctly', () => {
      const project = createTestProject('TRIPHASÉ_230V', 'monophase_reparti');
      const config: SRG2Config = { nodeId: 'srg2-node', enabled: true };
      const baselineResult = createMockBaselineResult();
      
      const result = srg2Regulator.apply(config, 215, project, baselineResult);
      
      expect(result.powerDownstream_kVA).toBeGreaterThan(0);
      expect(result.diversifiedLoad_kVA).toBeGreaterThan(0);
      expect(result.diversifiedProduction_kVA).toBeGreaterThanOrEqual(0);
      expect(result.netPower_kVA).toBeDefined();
    });
  });
});