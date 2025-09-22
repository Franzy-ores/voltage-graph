// SRG2 FIX: Tests de validation des correctifs appliqués
import { describe, test, expect, beforeEach } from 'vitest';
import { ElectricalCalculator } from '../electricalCalculations';
import type { Project, Node, Cable, CableType, VoltageRegulator, CalculationScenario } from '../../types/network';

describe('SRG2 Correctifs - Validation des problèmes corrigés', () => {
  let calculator: ElectricalCalculator;

  beforeEach(() => {
    calculator = new ElectricalCalculator(0.95);
  });

  // SRG2 FIX: Test correction surtension (250V) → tension régulée avec rapport LO1 (-3.5%)
  test('should apply correct transformation ratio for overvoltage (250V)', () => {
    const calculator = new ElectricalCalculator();
    
    // Test SRG2 regulation logic directly
    const mockRegulator = {
      id: 'REG1',
      nodeId: 'NODE1',
      type: 'SRG2' as any,
      targetVoltage_V: 230,
      enabled: true
    };
    
    // Simulate overvoltage condition (250V > UL threshold 246V)
    const initialVoltages = { A: 250, B: 250, C: 250 };
    
    // Apply SRG2 regulation logic
    const result = (calculator as any).applySRG2RegulationLogic(
      mockRegulator,
      initialVoltages,
      undefined // No previous state
    );
    
    // Should select LO1 step (-3.5% = 0.965 ratio) for 250V
    expect(result.targetVoltages.A).toBeCloseTo(0.965, 3); // Transformation ratio
    expect(result.switchStates.A).toBe('LO1');
    
    // SRG2 FIX: The SRG2 node itself should remain at 250V (measurement point)
    // Only downstream nodes will be transformed: 250V × 0.965 = 241.25V
    console.log(`SRG2 regulation: ${250}V input → LO1 step (ratio: ${result.targetVoltages.A})`);
    console.log(`SRG2 node voltage: 250V (unchanged - measurement point)`);
    console.log(`Downstream nodes voltage: ${(250 * result.targetVoltages.A).toFixed(1)}V (transformed)`);
  });

  // SRG2 FIX: Test correction sous-tension (220V) → rapport BO1 (+3.5%)
  test('should apply correct transformation ratio for undervoltage (220V)', () => {
    const calculator = new ElectricalCalculator();
    
    // Test SRG2 regulation for undervoltage
    const mockRegulator = {
      id: 'REG2',
      nodeId: 'NODE2',
      type: 'SRG2' as any,
      targetVoltage_V: 230,
      enabled: true
    };
    
    // Simulate undervoltage condition (220V < BO1 threshold 222V)
    const initialVoltages = { A: 220, B: 220, C: 220 };
    
    // Apply SRG2 regulation logic
    const result = (calculator as any).applySRG2RegulationLogic(
      mockRegulator,
      initialVoltages,
      undefined // No previous state
    );
    
    // Should select BO1 step (+3.5% = 1.035 ratio) for 220V
    expect(result.targetVoltages.A).toBeCloseTo(1.035, 3); // Transformation ratio
    expect(result.switchStates.A).toBe('BO1');
    
    // SRG2 FIX: The SRG2 node itself should remain at 220V (measurement point)
    // Only downstream nodes will be transformed: 220V × 1.035 = 227.7V
    console.log(`SRG2 regulation: ${220}V input → BO1 step (ratio: ${result.targetVoltages.A})`);
    console.log(`SRG2 node voltage: 220V (unchanged - measurement point)`);
    console.log(`Downstream nodes voltage: ${(220 * result.targetVoltages.A).toFixed(1)}V (transformed)`);
  });

  // SRG2 FIX: Test régulation par phase indépendante avec rapports de transformation
  test('SRG2-400V: Independent phase regulation with transformation ratios', () => {
    const regulator = createTestRegulator('400V_44kVA');
    
    // Simuler déséquilibre important entre phases
    const regulationResult = (calculator as any).applySRG2RegulationLogic(
      regulator,
      { A: 250, B: 210, C: 230 }, // A surtension, B sous-tension, C normale
      '400V'
    );
    
    console.log(`Mixed phases: A=${250}V (high), B=${210}V (low), C=${230}V (normal)`);
    console.log(`States: A=${regulationResult.switchStates.A}, B=${regulationResult.switchStates.B}, C=${regulationResult.switchStates.C}`);
    console.log(`Ratios: A=${regulationResult.targetVoltages.A}, B=${regulationResult.targetVoltages.B}, C=${regulationResult.targetVoltages.C}`);
    
    // SRG2 FIX: Chaque phase doit réguler indépendamment avec les bons rapports
    expect(regulationResult.switchStates.A).toMatch(/^LO[12]$/); // Abaissement pour phase A
    expect(regulationResult.switchStates.B).toMatch(/^BO[12]$/); // Augmentation pour phase B  
    expect(regulationResult.switchStates.C).toBe('BYP');         // Pas de régulation pour phase C
    
    // Vérifier que les rapports de transformation sont corrects
    expect(regulationResult.targetVoltages.A).toBeLessThan(1.0); // Ratio de réduction
    expect(regulationResult.targetVoltages.B).toBeGreaterThan(1.0); // Ratio d'augmentation
    expect(regulationResult.targetVoltages.C).toBe(1.0); // Pas de transformation
  });

  // SRG2 FIX: Test absence d'oscillation avec hystérésis et rapport BYP
  test('should prevent oscillation with hysteresis (244V → BYP)', () => {
    const calculator = new ElectricalCalculator();
    
    const mockRegulator = {
      id: 'REG3',
      nodeId: 'NODE3',
      type: 'SRG2' as any,
      targetVoltage_V: 230,
      enabled: true
    };
    
    // First calculation at threshold boundary (244V - within hysteresis zone)
    const voltageAtThreshold = { A: 244, B: 244, C: 244 }; // Just below UL threshold (246V)
    
    const result1 = (calculator as any).applySRG2RegulationLogic(
      mockRegulator,
      voltageAtThreshold,
      undefined
    );
    
    // Should not regulate (within hysteresis zone), ratio should be 1.0 (BYP)
    expect(result1.switchStates.A).toBe('BYP');
    expect(result1.targetVoltages.A).toBe(1.0); // BYP transformation ratio
    
    // SRG2 FIX: Both SRG2 node and downstream nodes should remain at 244V (no transformation)
    console.log(`SRG2 regulation: ${244}V input → BYP step (ratio: ${result1.targetVoltages.A})`);
    console.log(`SRG2 node voltage: 244V (unchanged - measurement point)`);
    console.log(`Downstream nodes voltage: ${(244 * result1.targetVoltages.A).toFixed(1)}V (no transformation)`);
  });

  // Helper: Créer régulateur de test 
  function createTestRegulator(type: '230V_77kVA' | '400V_44kVA'): VoltageRegulator {
    return {
      id: 'srg2-regulator',
      nodeId: 'regulator-node',
      type: type,
      enabled: true,
      targetVoltage_V: 230,
      maxPower_kVA: type === '400V_44kVA' ? 44 : 77
    };
  }
});