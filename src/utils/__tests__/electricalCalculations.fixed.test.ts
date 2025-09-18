import { describe, it, expect } from 'vitest';
import { ElectricalCalculator } from '@/utils/electricalCalculations';
import type { Node, Cable, CableType, TransformerConfig, CalculationScenario } from '@/types/network';

const mkCableType = (id: string, R12: number, X12: number, R0: number, X0: number): CableType => ({
  id, 
  label: id, 
  R12_ohm_per_km: R12, 
  X12_ohm_per_km: X12, 
  R0_ohm_per_km: R0, 
  X0_ohm_per_km: X0, 
  matiere: 'CUIVRE', 
  posesPermises: ['AÉRIEN','SOUTERRAIN']
});

const baseTransformer = (Uline: number, S_kVA: number, Ucc_percent = 0, xOverR?: number): TransformerConfig => ({
  rating: '160kVA', 
  nominalPower_kVA: S_kVA, 
  nominalVoltage_V: Uline, 
  shortCircuitVoltage_percent: Ucc_percent, 
  cosPhi: 1, 
  xOverR
});

const degLatForMeters = (m: number) => m / 111_000; // approx conversion

describe('ElectricalCalculator - Corrections and Consistency Tests', () => {
  
  describe('🎯 Current calculation corrections (√3 factor)', () => {
    it('TRI_230V_3F uses √3 factor (corrected)', () => {
      const calc = new ElectricalCalculator();
      const Itri = (calc as any).calculateCurrentA(10, 'TRI_230V_3F', 230);
      const expected = 10000 / (Math.sqrt(3) * 230);
      
      console.log(`🧪 TRI_230V_3F: I_calculated=${Itri.toFixed(3)}A, I_expected=${expected.toFixed(3)}A`);
      expect(Math.abs(Itri - expected)).toBeLessThan(1e-6);
    });

    it('TÉTRA_3P+N_230_400V uses √3*400', () => {
      const calc = new ElectricalCalculator();
      const Itri = (calc as any).calculateCurrentA(10, 'TÉTRA_3P+N_230_400V', 400);
      const expected = 10000 / (Math.sqrt(3) * 400);
      
      console.log(`🧪 TÉTRA_400V: I_calculated=${Itri.toFixed(3)}A, I_expected=${expected.toFixed(3)}A`);
      expect(Math.abs(Itri - expected)).toBeLessThan(1e-6);
    });

    it('MONO_230V_PN direct division (no √3)', () => {
      const calc = new ElectricalCalculator();
      const Imono = (calc as any).calculateCurrentA(10, 'MONO_230V_PN', 230);
      const expected = 10000 / 230;
      
      console.log(`🧪 MONO_230V_PN: I_calculated=${Imono.toFixed(3)}A, I_expected=${expected.toFixed(3)}A`);
      expect(Math.abs(Imono - expected)).toBeLessThan(1e-6);
    });

    it('MONO_230V_PP direct division (no √3)', () => {
      const calc = new ElectricalCalculator();
      const Imono = (calc as any).calculateCurrentA(10, 'MONO_230V_PP', 230);
      const expected = 10000 / 230;
      
      console.log(`🧪 MONO_230V_PP: I_calculated=${Imono.toFixed(3)}A, I_expected=${expected.toFixed(3)}A`);
      expect(Math.abs(Imono - expected)).toBeLessThan(1e-6);
    });
  });

  describe('🔧 R/X selection corrections (always use R12 for phase drops)', () => {
    it('MONO_230V_PN now uses R12 for voltage drops (corrected)', () => {
      const calc = new ElectricalCalculator();
      const cableType = mkCableType('test', 0.2, 0.1, 0.6, 0.3);
      
      const result = (calc as any).selectRX(cableType, 'MONO_230V_PN');
      
      // CORRECTION: MONO_230V_PN doit maintenant utiliser R12 pour les chutes de phase
      expect(result.R).toBe(0.2); // R12, pas R0
      expect(result.X).toBe(0.1); // X12, pas X0
      expect(result.R0).toBe(0.6); // R0 disponible pour calculs neutre
      expect(result.X0).toBe(0.3); // X0 disponible pour calculs neutre
    });

    it('TRI_230V_3F uses R12/X12', () => {
      const calc = new ElectricalCalculator();
      const cableType = mkCableType('test', 0.2, 0.1, 0.6, 0.3);
      
      const result = (calc as any).selectRX(cableType, 'TRI_230V_3F');
      
      expect(result.R).toBe(0.2); // R12
      expect(result.X).toBe(0.1); // X12
    });
  });

  describe('📊 Numerical validation examples', () => {
    it('Charge 10 kVA, câble 100m R=0.5Ω/km - Validation numérique', () => {
      const S_kVA = 10;
      const L_km = 0.1; // 100m
      const R_ohm_per_km = 0.5;
      const R_total = R_ohm_per_km * L_km; // 0.05 Ω
      
      // Calculs théoriques attendus
      const sqrt3 = Math.sqrt(3); // ≈ 1.732
      
      // Triphasé 400V (TÉTRA)
      const I_tri_400V = 10000 / (sqrt3 * 400); // ≈ 14.43 A
      const deltaU_phase_tri = I_tri_400V * R_total; // ≈ 0.72 V
      const deltaU_line_tri = deltaU_phase_tri * sqrt3; // ≈ 1.25 V
      
      // Monophasé 230V 
      const I_mono_230V = 10000 / 230; // ≈ 43.48 A
      const deltaU_mono = I_mono_230V * R_total; // ≈ 2.17 V
      
      // Ratio théorique des chutes
      const expected_ratio = deltaU_mono / deltaU_line_tri; // ≈ 1.74
      
      console.log('📊 Calculs théoriques:');
      console.log(`   Triphasé 400V: I=${I_tri_400V.toFixed(2)}A, ΔU_line=${deltaU_line_tri.toFixed(3)}V`);
      console.log(`   Monophasé 230V: I=${I_mono_230V.toFixed(2)}A, ΔU=${deltaU_mono.toFixed(3)}V`);
      console.log(`   Ratio ΔU_mono/ΔU_tri = ${expected_ratio.toFixed(2)} (attendu ≈ 1.74)`);
      
      // Vérifications
      expect(I_tri_400V).toBeCloseTo(14.43, 1);
      expect(I_mono_230V).toBeCloseTo(43.48, 1);
      expect(deltaU_line_tri).toBeCloseTo(1.25, 2);
      expect(deltaU_mono).toBeCloseTo(2.17, 2);
      expect(expected_ratio).toBeCloseTo(1.74, 1);
    });

    it('Test intégration: Réseau complet avec chutes cohérentes', () => {
      const calc = new ElectricalCalculator(1.0); // cosφ = 1
      
      // Configuration triphasée 400V
      const nodesTri: Node[] = [
        { id: 'src', name: 'Source', lat: 0, lng: 0, connectionType: 'TÉTRA_3P+N_230_400V', clients: [], productions: [], isSource: true },
        { id: 'n1', name: 'Load', lat: degLatForMeters(100), lng: 0, connectionType: 'TÉTRA_3P+N_230_400V', clients: [{ id: 'c1', label: 'Load', S_kVA: 10 }], productions: [] },
      ];
      
      // Configuration monophasée 230V
      const nodesMono: Node[] = [
        { id: 'src', name: 'Source', lat: 0, lng: 0, connectionType: 'MONO_230V_PN', clients: [], productions: [], isSource: true },
        { id: 'n1', name: 'Load', lat: degLatForMeters(100), lng: 0, connectionType: 'MONO_230V_PN', clients: [{ id: 'c1', label: 'Load', S_kVA: 10 }], productions: [] },
      ];
      
      const cables: Cable[] = [
        { id: 'cab1', name: 'C1', typeId: 't1', pose: 'AÉRIEN', nodeAId: 'src', nodeBId: 'n1', 
          coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(100), lng: 0 }] }
      ];
      
      const cableTypes: CableType[] = [mkCableType('t1', 0.5, 0, 0.5, 0)];
      const transformer400V = baseTransformer(400, 160, 0);
      const transformer230V = baseTransformer(230, 160, 0);

      const resultTri = calc.calculateScenario(nodesTri, cables, cableTypes, 'PRÉLÈVEMENT', 100, 100, transformer400V);
      const resultMono = calc.calculateScenario(nodesMono, cables, cableTypes, 'PRÉLÈVEMENT', 100, 100, transformer230V);
      
      const cabTri = resultTri.cables[0];
      const cabMono = resultMono.cables[0];
      
      console.log('🧪 Résultats intégration:');
      console.log(`   Triphasé: I=${cabTri.current_A?.toFixed(2)}A, ΔU=${cabTri.voltageDrop_V?.toFixed(3)}V`);
      console.log(`   Monophasé: I=${cabMono.current_A?.toFixed(2)}A, ΔU=${cabMono.voltageDrop_V?.toFixed(3)}V`);
      
      // Vérifications des courants (selon formules corrigées)
      expect(cabTri.current_A!).toBeCloseTo(14.43, 1); // 10000/(√3×400)
      expect(cabMono.current_A!).toBeCloseTo(43.48, 1); // 10000/230
      
      // Ratio des courants devrait être ≈ √3 ≈ 1.732
      const currentRatio = cabMono.current_A! / cabTri.current_A!;
      expect(currentRatio).toBeCloseTo(Math.sqrt(3), 0.1);
      
      // Vérifications de cohérence des chutes (tenant compte du facteur √3 et R0 vs R12)
      expect(cabTri.voltageDrop_V!).toBeGreaterThan(1.0);
      expect(cabTri.voltageDrop_V!).toBeLessThan(1.5);
      expect(cabMono.voltageDrop_V!).toBeGreaterThan(2.0);
      expect(cabMono.voltageDrop_V!).toBeLessThan(2.5);
    });
  });

  describe('🛡️ Robustness and error handling', () => {
    it('handles invalid S_kVA gracefully', () => {
      const calc = new ElectricalCalculator();
      
      expect((calc as any).calculateCurrentA(NaN, 'TRI_230V_3F', 230)).toBe(0);
      expect((calc as any).calculateCurrentA(Infinity, 'TRI_230V_3F', 230)).toBe(0);
    });

    it('handles invalid voltage gracefully', () => {
      const calc = new ElectricalCalculator();
      
      // Voltage invalide -> doit utiliser U_base
      const result1 = (calc as any).calculateCurrentA(10, 'TRI_230V_3F', 0);
      const result2 = (calc as any).calculateCurrentA(10, 'TRI_230V_3F', 230);
      
      expect(result1).toBe(result2); // Doit fallback sur U_base
    });

    it('throws error for completely invalid base voltage', () => {
      const calc = new ElectricalCalculator();
      
      expect(() => {
        (calc as any).calculateCurrentA(10, 'UNKNOWN_TYPE' as any, undefined);
      }).toThrow();
    });
  });

  describe('🔄 Conversion utilities', () => {
    it('phase to line voltage conversion', () => {
      const calc = new ElectricalCalculator();
      
      const U_phase = 230;
      const U_line = (calc as any).toLineVoltage(U_phase);
      const expected = 230 * Math.sqrt(3);
      
      expect(Math.abs(U_line - expected)).toBeLessThan(1e-6);
      expect(U_line).toBeCloseTo(398.37, 1);
    });

    it('line to phase voltage conversion', () => {
      const calc = new ElectricalCalculator();
      
      const U_line = 400;
      const U_phase = (calc as any).toPhaseVoltage(U_line);
      const expected = 400 / Math.sqrt(3);
      
      expect(Math.abs(U_phase - expected)).toBeLessThan(1e-6);
      expect(U_phase).toBeCloseTo(230.94, 1);
    });

    it('round-trip conversion consistency', () => {
      const calc = new ElectricalCalculator();
      
      const original = 230;
      const converted = (calc as any).toPhaseVoltage((calc as any).toLineVoltage(original));
      
      expect(Math.abs(converted - original)).toBeLessThan(1e-10);
    });
  });

  describe('📈 Benchmark and regression tests', () => {
    it('Cas de référence: 10kVA, 100m, R=0.5Ω/km', () => {
      const calc = new ElectricalCalculator(1.0);
      
      // Configuration de référence
      const S_kVA = 10;
      const L_m = 100;
      const R_ohm_km = 0.5;
      
      // Test avec différents types de connexion
      const connectionTypes = ['MONO_230V_PN', 'MONO_230V_PP', 'TRI_230V_3F', 'TÉTRA_3P+N_230_400V'] as const;
      const results: Record<string, number> = {};
      
      for (const connType of connectionTypes) {
        const voltage = connType.includes('400V') ? 400 : 230;
        const current = (calc as any).calculateCurrentA(S_kVA, connType, voltage);
        results[connType] = current;
      }
      
      console.log('📈 Courants par type de connexion (10kVA):');
      for (const [type, current] of Object.entries(results)) {
        console.log(`   ${type}: ${current.toFixed(2)}A`);
      }
      
      // Vérifications des ratios attendus
      const ratio_mono_tri = results['MONO_230V_PN'] / results['TRI_230V_3F'];
      const ratio_tetra_tri = results['TRI_230V_3F'] / results['TÉTRA_3P+N_230_400V'];
      
      expect(ratio_mono_tri).toBeCloseTo(Math.sqrt(3), 0.1);
      expect(ratio_tetra_tri).toBeCloseTo(400/230, 0.1);
    });
  });
});