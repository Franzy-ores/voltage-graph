// SRG2 FIX: Tests de validation des correctifs appliqués
import { describe, test, expect, beforeEach } from 'vitest';
import { ElectricalCalculator } from '../electricalCalculations';
import type { Project, Node, Cable, CableType, VoltageRegulator, CalculationScenario } from '../../types/network';

describe('SRG2 Correctifs - Validation des problèmes corrigés', () => {
  let calculator: ElectricalCalculator;

  beforeEach(() => {
    calculator = new ElectricalCalculator(0.95);
  });

  // SRG2 FIX: Test correction surtension (>246V) → tension corrigée ≈ 230V sans overshoot
  test('SRG2-400V: Correction surtension sans overshoot', () => {
    const regulator = createTestRegulator('400V_44kVA');
    
    // Simuler tensions élevées (250V sur toutes les phases)
    const regulationResult = (calculator as any).applySRG2RegulationLogic(
      regulator,
      { A: 250, B: 248, C: 252 },
      '400V'
    );
    
    // SRG2 FIX: Vérifier que la correction ne cause pas d'overshoot
    const correctedA = 250 + regulationResult.adjustmentPerPhase.A;
    const correctedB = 248 + regulationResult.adjustmentPerPhase.B;
    const correctedC = 252 + regulationResult.adjustmentPerPhase.C;
    
    console.log(`Original: A=${250}V, B=${248}V, C=${252}V`);
    console.log(`Adjustments: A=${regulationResult.adjustmentPerPhase.A}V, B=${regulationResult.adjustmentPerPhase.B}V, C=${regulationResult.adjustmentPerPhase.C}V`);
    console.log(`Corrected: A=${correctedA}V, B=${correctedB}V, C=${correctedC}V`);
    
    // Vérifications critiques après correctifs
    expect(correctedA).toBeGreaterThan(225); // Pas d'overshoot vers le bas
    expect(correctedA).toBeLessThan(235);    // Proche de 230V cible
    expect(correctedB).toBeGreaterThan(225);
    expect(correctedB).toBeLessThan(235);
    expect(correctedC).toBeGreaterThan(225);
    expect(correctedC).toBeLessThan(235);
    
    // Vérifier que la régulation est bien activée
    expect(regulationResult.canRegulate).toBe(true);
    expect(['LO1', 'LO2']).toContain(regulationResult.switchStates.A);
  });

  // SRG2 FIX: Test correction sous-tension (<222V) → tension relevée ≈ 230V
  test('SRG2-400V: Correction sous-tension effective', () => {
    const regulator = createTestRegulator('400V_44kVA');
    
    // Simuler tensions basses (210V sur toutes les phases)
    const regulationResult = (calculator as any).applySRG2RegulationLogic(
      regulator,
      { A: 210, B: 208, C: 212 },
      '400V'
    );
    
    const correctedA = 210 + regulationResult.adjustmentPerPhase.A;
    const correctedB = 208 + regulationResult.adjustmentPerPhase.B;
    const correctedC = 212 + regulationResult.adjustmentPerPhase.C;
    
    console.log(`Original: A=${210}V, B=${208}V, C=${212}V`);
    console.log(`Adjustments: A=${regulationResult.adjustmentPerPhase.A}V, B=${regulationResult.adjustmentPerPhase.B}V, C=${regulationResult.adjustmentPerPhase.C}V`);
    console.log(`Corrected: A=${correctedA}V, B=${correctedB}V, C=${correctedC}V`);
    
    // SRG2 FIX: Vérifier que la sous-tension est bien corrigée maintenant
    expect(correctedA).toBeGreaterThan(225); // Tension relevée
    expect(correctedA).toBeLessThan(235);    // Proche de 230V cible
    expect(correctedB).toBeGreaterThan(225);
    expect(correctedB).toBeLessThan(235);
    expect(correctedC).toBeGreaterThan(225);
    expect(correctedC).toBeLessThan(235);
    
    // Vérifier que la régulation est bien activée pour augmentation
    expect(regulationResult.canRegulate).toBe(true);
    expect(['BO1', 'BO2']).toContain(regulationResult.switchStates.A);
  });

  // SRG2 FIX: Test régulation par phase indépendante (pas de moyenne)
  test('SRG2-400V: Régulation indépendante par phase', () => {
    const regulator = createTestRegulator('400V_44kVA');
    
    // Simuler déséquilibre important entre phases
    const regulationResult = (calculator as any).applySRG2RegulationLogic(
      regulator,
      { A: 250, B: 210, C: 230 }, // A surtension, B sous-tension, C normale
      '400V'
    );
    
    console.log(`Mixed phases: A=${250}V (high), B=${210}V (low), C=${230}V (normal)`);
    console.log(`States: A=${regulationResult.switchStates.A}, B=${regulationResult.switchStates.B}, C=${regulationResult.switchStates.C}`);
    console.log(`Adjustments: A=${regulationResult.adjustmentPerPhase.A}V, B=${regulationResult.adjustmentPerPhase.B}V, C=${regulationResult.adjustmentPerPhase.C}V`);
    
    // SRG2 FIX: Chaque phase doit réguler indépendamment
    expect(regulationResult.switchStates.A).toMatch(/^LO[12]$/); // Abaissement pour phase A
    expect(regulationResult.switchStates.B).toMatch(/^BO[12]$/); // Augmentation pour phase B  
    expect(regulationResult.switchStates.C).toBe('BYP');         // Pas de régulation pour phase C
    
    // Vérifier que les corrections vont dans le bon sens
    expect(regulationResult.adjustmentPerPhase.A).toBeLessThan(0); // Correction négative pour surtension
    expect(regulationResult.adjustmentPerPhase.B).toBeGreaterThan(0); // Correction positive pour sous-tension
    expect(regulationResult.adjustmentPerPhase.C).toBe(0); // Pas de correction
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