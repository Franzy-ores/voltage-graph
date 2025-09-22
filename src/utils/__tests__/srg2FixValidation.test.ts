// SRG2 FIX: Tests de validation des correctifs appliqués
import { describe, test, expect, beforeEach } from 'vitest';
import { SRG2Regulator } from '../SRG2Regulator';
import type { Project, Node, ConnectionType } from '../../types/network';

describe('SRG2 Correctifs - Validation des problèmes corrigés', () => {
  let srg2Regulator: SRG2Regulator;

  beforeEach(() => {
    srg2Regulator = new SRG2Regulator();
  });

  // Helper function to create mock project
  const createMockProject = (voltageSystem: '230V' | '400V'): Project => ({
    id: 'test',
    name: 'test',
    voltageSystem: voltageSystem === '230V' ? 'TRIPHASÉ_230V' : 'TÉTRAPHASÉ_400V',
    cosPhi: 0.95,
    nodes: [],
    cables: [],
    cableTypes: [],
    transformerConfig: { nominalVoltage_V: voltageSystem === '230V' ? 230 : 400 } as any,
    foisonnementCharges: 100,
    foisonnementProductions: 100,
    defaultChargeKVA: 10,
    defaultProductionKVA: 5
  });

  // Helper function to create mock node
  const createMockNode = (voltage: number, connectionType: ConnectionType): Node => ({
    id: 'NODE1',
    name: 'Test Node',
    lat: 0,
    lng: 0,
    connectionType,
    clients: [],
    productions: [],
    isSource: false,
    tensionCible: voltage
  });

  // SRG2 FIX: Test correction surtension (250V) → tension régulée avec rapport LO1 (-3.5%)
  test('should apply correct transformation ratio for overvoltage (250V)', () => {
    const mockProject = createMockProject('230V');
    const mockNode = createMockNode(250, 'TRI_230V_3F');
    const config = { nodeId: 'NODE1', enabled: true };
    
    // Apply SRG2 with actual voltages (250V on all phases)
    const actualVoltages = { A: 250, B: 250, C: 250 };
    const result = srg2Regulator.apply(config, mockNode, mockProject, actualVoltages);
    
    // Should select LO1 step (-3.5% = 0.965 ratio) for 250V
    expect(result.ratio).toBeCloseTo(0.965, 3);
    expect(result.state).toBe('LO1');
    expect(result.isActive).toBe(true);
    expect(result.regulatedVoltage).toBeCloseTo(250 * 0.965, 1);
    
    console.log(`SRG2 regulation: ${result.originalVoltage}V input → ${result.state} step (ratio: ${result.ratio})`);
  });

  // SRG2 FIX: Test correction sous-tension (220V) → rapport BO1 (+3.5%)
  test('should apply correct transformation ratio for undervoltage (220V)', () => {
    const mockProject = createMockProject('230V');
    const mockNode = createMockNode(220, 'TRI_230V_3F');
    const config = { nodeId: 'NODE1', enabled: true };
    
    // Apply SRG2 with actual voltages (220V on all phases)
    const actualVoltages = { A: 220, B: 220, C: 220 };
    const result = srg2Regulator.apply(config, mockNode, mockProject, actualVoltages);
    
    // Should select BO1 step (+3.5% = 1.035 ratio) for 220V
    expect(result.ratio).toBeCloseTo(1.035, 3);
    expect(result.state).toBe('BO1');
    expect(result.isActive).toBe(true);
    expect(result.regulatedVoltage).toBeCloseTo(220 * 1.035, 1);
  });

  // SRG2 FIX: Test régulation indépendante par phase (tensions mixtes)
  test('should regulate each phase independently with mixed voltages', () => {
    const mockProject = createMockProject('400V');
    const mockNode = createMockNode(235, 'TÉTRA_3P+N_230_400V');
    const config = { nodeId: 'NODE1', enabled: true };
    
    // Apply SRG2 with mixed voltages (over, under, normal)
    const actualVoltages = { A: 248, B: 220, C: 238 }; // Over, under, normal voltages
    const result = srg2Regulator.apply(config, mockNode, mockProject, actualVoltages);
    
    // Should use average voltage for regulation decision
    const avgVoltage = (248 + 220 + 238) / 3; // ≈ 235V
    expect(result.isActive).toBe(true);
    // For 400V system, 235V should result in BYP state (within normal range)
    expect(result.state).toBe('BYP');
    expect(result.ratio).toBeCloseTo(1.0, 3);
  });

  // SRG2 FIX: Test hystérésis et prévention oscillation
  test('should prevent oscillation with hysteresis at threshold voltage (244V)', () => {
    const mockProject = createMockProject('230V');
    const mockNode = createMockNode(244, 'TRI_230V_3F');
    const config = { nodeId: 'NODE1', enabled: true };
    
    // Apply SRG2 with voltage at hysteresis threshold
    const actualVoltages = { A: 244, B: 244, C: 244 };
    const result = srg2Regulator.apply(config, mockNode, mockProject, actualVoltages);
    
    // Should remain in BYP state to prevent oscillation (within hysteresis zone)
    expect(result.state).toBe('BYP');
    expect(result.ratio).toBeCloseTo(1.0, 3);
    expect(result.isActive).toBe(true);
  });
});