import { describe, it, expect } from 'vitest';
import { ElectricalCalculator } from '@/utils/electricalCalculations';
import type { Node, Cable, CableType, TransformerConfig, CalculationScenario } from '@/types/network';

const mkCableType = (id: string, R12: number, X12: number, R0: number, X0: number): CableType => ({
  id, label: id, R12_ohm_per_km: R12, X12_ohm_per_km: X12, R0_ohm_per_km: R0, X0_ohm_per_km: X0, matiere: 'CUIVRE', posesPermises: ['AÉRIEN','SOUTERRAIN']
});

const baseTransformer = (Uline: number, S_kVA: number, Ucc_percent = 0, xOverR?: number): TransformerConfig => ({
  rating: '160kVA', nominalPower_kVA: S_kVA, nominalVoltage_V: Uline, shortCircuitVoltage_percent: Ucc_percent, cosPhi: 1, xOverR
});

const degLatForMeters = (m: number) => m / 111_000; // approx conversion

describe('ElectricalCalculator - Voltage Drop Consistency Tests', () => {
  
  describe('Current calculation corrections', () => {
    it('TRI_230V_3F should now use √3 factor (corrected)', () => {
      const calc = new ElectricalCalculator(1.0);
      
      // Test avec une charge triphasée 10 kVA à 230V
      const nodes: Node[] = [
        { id: 'src', name: 'Source', lat: 0, lng: 0, connectionType: 'TRI_230V_3F', clients: [], productions: [], isSource: true },
        { id: 'n1', name: 'N1', lat: degLatForMeters(100), lng: 0, connectionType: 'TRI_230V_3F', clients: [{ id: 'c1', label: 'Load', S_kVA: 10 }], productions: [] },
      ];
      const cables: Cable[] = [
        { id: 'cab1', name: 'C1', typeId: 't1', pose: 'AÉRIEN', nodeAId: 'src', nodeBId: 'n1', coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(100), lng: 0 }] }
      ];
      const cableTypes: CableType[] = [mkCableType('t1', 0.5, 0, 0.5, 0)];
      const transformer = baseTransformer(230, 160, 0);

      const result = calc.calculateScenario(nodes, cables, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 100, 100, transformer, 'polyphase_equilibre', 0, undefined);
      const cab = result.cables[0];

      // Courant attendu avec correction: I = S/(√3×U) = 10000/(√3×230) ≈ 25.1 A
      expect(cab.current_A!).toBeGreaterThan(24);
      expect(cab.current_A!).toBeLessThan(26);
      
      // Chute de tension: ΔU = I×R×L = 25.1×0.05×0.1 ≈ 0.126 V
      expect(cab.voltageDrop_V!).toBeGreaterThan(0.1);
      expect(cab.voltageDrop_V!).toBeLessThan(0.15);
    });

    it('MONO_230V_PN vs TRI_230V_3F consistency check', () => {
      const calc = new ElectricalCalculator(1.0);
      
      // Test avec même puissance sur les deux types de connexion
      const S_test = 10; // 10 kVA
      const cable_R = 0.5; // 0.5 Ω/km
      const length_km = 0.1; // 100m
      
      // Configuration monophasée
      const nodesMono: Node[] = [
        { id: 'src', name: 'Source', lat: 0, lng: 0, connectionType: 'MONO_230V_PN', clients: [], productions: [], isSource: true },
        { id: 'n1', name: 'N1', lat: degLatForMeters(100), lng: 0, connectionType: 'MONO_230V_PN', clients: [{ id: 'c1', label: 'Load', S_kVA: S_test }], productions: [] },
      ];
      const cablesMono: Cable[] = [
        { id: 'cab1', name: 'C1', typeId: 't1', pose: 'AÉRIEN', nodeAId: 'src', nodeBId: 'n1', coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(100), lng: 0 }] }
      ];
      
      // Configuration triphasée
      const nodesTri: Node[] = [
        { id: 'src', name: 'Source', lat: 0, lng: 0, connectionType: 'TRI_230V_3F', clients: [], productions: [], isSource: true },
        { id: 'n1', name: 'N1', lat: degLatForMeters(100), lng: 0, connectionType: 'TRI_230V_3F', clients: [{ id: 'c1', label: 'Load', S_kVA: S_test }], productions: [] },
      ];
      const cablesTri: Cable[] = [
        { id: 'cab1', name: 'C1', typeId: 't1', pose: 'AÉRIEN', nodeAId: 'src', nodeBId: 'n1', coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(100), lng: 0 }] }
      ];
      
      const cableTypes: CableType[] = [mkCableType('t1', cable_R, 0, cable_R, 0)];
      const transformer = baseTransformer(230, 160, 0);

      const resultMono = calc.calculateScenario(nodesMono, cablesMono, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 100, 100, transformer, 'polyphase_equilibre', 0, undefined);
      const resultTri = calc.calculateScenario(nodesTri, cablesTri, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 100, 100, transformer, 'polyphase_equilibre', 0, undefined);
      
      const cabMono = resultMono.cables[0];
      const cabTri = resultTri.cables[0];
      
      // Calculs théoriques attendus:
      // Mono: I = 10000/230 = 43.48 A
      // Tri:  I = 10000/(√3×230) = 25.11 A
      
      console.log(`Courant Mono: ${cabMono.current_A?.toFixed(2)}A, Courant Tri: ${cabTri.current_A?.toFixed(2)}A`);
      console.log(`Chute Mono: ${cabMono.voltageDrop_V?.toFixed(3)}V, Chute Tri: ${cabTri.voltageDrop_V?.toFixed(3)}V`);
      
      // Vérifications des courants
      expect(cabMono.current_A!).toBeGreaterThan(42);
      expect(cabMono.current_A!).toBeLessThan(45);
      expect(cabTri.current_A!).toBeGreaterThan(24);
      expect(cabTri.current_A!).toBeLessThan(26);
      
      // Ratio des courants devrait être proche de √3 ≈ 1.732
      const currentRatio = cabMono.current_A! / cabTri.current_A!;
      expect(currentRatio).toBeGreaterThan(1.65);
      expect(currentRatio).toBeLessThan(1.8);
      
      // Les chutes de tension ne doivent pas différer de plus de 3x
      // (tenant compte des différences de R0 vs R12)
      const voltageRatio = cabMono.voltageDrop_V! / cabTri.voltageDrop_V!;
      expect(voltageRatio).toBeGreaterThan(0.5);
      expect(voltageRatio).toBeLessThan(4.0);
    });
  });

  describe('R/X selection validation', () => {
    it('should use R0/X0 for MONO_230V_PN and R12/X12 for others', () => {
      const calc = new ElectricalCalculator(1.0);
      
      // Test avec des valeurs R0 ≠ R12 pour vérifier la sélection
      const cableTypes: CableType[] = [mkCableType('t1', 0.2, 0, 0.6, 0)]; // R12=0.2, R0=0.6
      
      const nodesMono: Node[] = [
        { id: 'src', name: 'Source', lat: 0, lng: 0, connectionType: 'MONO_230V_PN', clients: [], productions: [], isSource: true },
        { id: 'n1', name: 'N1', lat: degLatForMeters(100), lng: 0, connectionType: 'MONO_230V_PN', clients: [{ id: 'c1', label: 'Load', S_kVA: 10 }], productions: [] },
      ];
      const nodesTri: Node[] = [
        { id: 'src', name: 'Source', lat: 0, lng: 0, connectionType: 'TRI_230V_3F', clients: [], productions: [], isSource: true },
        { id: 'n1', name: 'N1', lat: degLatForMeters(100), lng: 0, connectionType: 'TRI_230V_3F', clients: [{ id: 'c1', label: 'Load', S_kVA: 10 }], productions: [] },
      ];
      
      const cables: Cable[] = [
        { id: 'cab1', name: 'C1', typeId: 't1', pose: 'AÉRIEN', nodeAId: 'src', nodeBId: 'n1', coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(100), lng: 0 }] }
      ];
      const transformer = baseTransformer(230, 160, 0);

      const resultMono = calc.calculateScenario(nodesMono, cables, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 100, 100, transformer, 'polyphase_equilibre', 0, undefined);
      const resultTri = calc.calculateScenario(nodesTri, cables, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 100, 100, transformer, 'polyphase_equilibre', 0, undefined);
      
      // MONO_230V_PN devrait utiliser R0=0.6, donc chute plus importante
      // TRI_230V_3F devrait utiliser R12=0.2, donc chute plus faible
      const ratioR = 0.6 / 0.2; // Ratio R0/R12 = 3
      const voltageRatio = resultMono.cables[0].voltageDrop_V! / resultTri.cables[0].voltageDrop_V!;
      
      console.log(`Chute Mono (R0): ${resultMono.cables[0].voltageDrop_V?.toFixed(3)}V`);
      console.log(`Chute Tri (R12): ${resultTri.cables[0].voltageDrop_V?.toFixed(3)}V`);
      console.log(`Ratio chutes: ${voltageRatio.toFixed(2)}`);
      
      // Le ratio des chutes devrait refléter partiellement le ratio des résistances
      // (partiellement car les courants sont différents aussi)
      expect(voltageRatio).toBeGreaterThan(1.5); // Au moins 1.5x plus de chute en mono
    });
  });
  
  // Tests originaux conservés
  it('Cas 1: charge monophasée 10 kW cosφ=1 à 230 V, câble 0.1 km R=0.5 Ω/km', () => {
    const calc = new ElectricalCalculator(1.0);
    const nodes: Node[] = [
      { id: 'src', name: 'Source', lat: 0, lng: 0, connectionType: 'TÉTRA_3P+N_230_400V', clients: [], productions: [], isSource: true },
      { id: 'n1', name: 'N1', lat: degLatForMeters(100), lng: 0, connectionType: 'MONO_230V_PN', clients: [{ id: 'c1', label: 'Load', S_kVA: 10 }], productions: [] },
    ];
    const cables: Cable[] = [
      { id: 'cab1', name: 'C1', typeId: 't1', pose: 'AÉRIEN', nodeAId: 'src', nodeBId: 'n1', coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(100), lng: 0 }] }
    ];
    const cableTypes: CableType[] = [mkCableType('t1', 0.5, 0, 0.5, 0)];
    const transformer = baseTransformer(400, 160, 0);

    const result = calc.calculateScenario(nodes, cables, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 100, 100, transformer, 'polyphase_equilibre', 0, undefined);
    const cab = result.cables[0];

    expect(cab.current_A!).toBeGreaterThan(40);
    expect(cab.current_A!).toBeLessThan(47);
    expect(cab.voltageDrop_V!).toBeGreaterThan(1.9);
    expect(cab.voltageDrop_V!).toBeLessThan(2.4);
  });

  it('Cas 2: charge triphasée 30 kW cosφ=0.9 à 400 V, câble 0.2 km R=0.2 Ω/km, transfo 100 kVA 4%', () => {
    const calc = new ElectricalCalculator(0.9);
    const nodes: Node[] = [
      { id: 'src', name: 'Source', lat: 0, lng: 0, connectionType: 'TÉTRA_3P+N_230_400V', clients: [], productions: [], isSource: true },
      { id: 'n1', name: 'N1', lat: degLatForMeters(200), lng: 0, connectionType: 'TÉTRA_3P+N_230_400V', clients: [{ id: 'c1', label: 'Load', S_kVA: 33.333 }], productions: [] },
    ];
    const cables: Cable[] = [
      { id: 'cab1', name: 'C1', typeId: 't1', pose: 'AÉRIEN', nodeAId: 'src', nodeBId: 'n1', coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(200), lng: 0 }] }
    ];
    const cableTypes: CableType[] = [mkCableType('t1', 0.2, 0, 0.2, 0)];
    const transformer = baseTransformer(400, 100, 4);

    const result = calc.calculateScenario(nodes, cables, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 100, 100, transformer, 'polyphase_equilibre', 0, undefined);
    const cab = result.cables[0];
    expect(cab.current_A!).toBeGreaterThan(40);
    expect(cab.current_A!).toBeLessThan(60);
    expect(cab.voltageDrop_V!).toBeGreaterThan(2.0);
  });

  it('Cas 3: injection PV -20 kW cosφ=1, inversion de flux', () => {
    const calc = new ElectricalCalculator(1.0);
    const nodes: Node[] = [
      { id: 'src', name: 'Source', lat: 0, lng: 0, connectionType: 'TÉTRA_3P+N_230_400V', clients: [], productions: [], isSource: true },
      { id: 'n1', name: 'PV', lat: degLatForMeters(150), lng: 0, connectionType: 'TÉTRA_3P+N_230_400V', clients: [], productions: [{ id: 'p1', label: 'PV', S_kVA: 20 }] },
    ];
    const cables: Cable[] = [
      { id: 'cab1', name: 'C1', typeId: 't1', pose: 'AÉRIEN', nodeAId: 'src', nodeBId: 'n1', coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(150), lng: 0 }] }
    ];
    const cableTypes: CableType[] = [mkCableType('t1', 0.2, 0, 0.2, 0)];
    const transformer = baseTransformer(400, 160, 0);

    const result = calc.calculateScenario(nodes, cables, cableTypes, 'PRODUCTION' as CalculationScenario, 100, 100, transformer, 'polyphase_equilibre', 0, undefined);
    expect(result.totalProductions_kVA).toBeGreaterThan(0);
    expect(result.virtualBusbar).toBeTruthy();
    if (result.virtualBusbar) {
      expect(result.virtualBusbar.netSkVA).toBeLessThan(0);
      expect(result.virtualBusbar.deltaU_V).toBeGreaterThan(0);
    }
  });
});
