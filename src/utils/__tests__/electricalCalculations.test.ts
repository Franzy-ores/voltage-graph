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

describe('ElectricalCalculator - basic LV radial cases', () => {
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
    const transformer = baseTransformer(400, 160, 0); // pas de chute transfo

    const result = calc.calculateScenario(nodes, cables, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 100, 100, transformer, 'polyphase_equilibre', 0, undefined);
    const cab = result.cables[0];

    // Courant attendu ~ 43.5 A ; ΔU ~ I * R * L = 43.5 * 0.05 = 2.175 V
    expect(cab.current_A!).toBeGreaterThan(40);
    expect(cab.current_A!).toBeLessThan(47);
    expect(cab.voltageDrop_V!).toBeGreaterThan(1.9);
    expect(cab.voltageDrop_V!).toBeLessThan(2.4);
    expect(Math.abs((cab.voltageDropPercent || 0) - (cab.voltageDrop_V! / 230 * 100))).toBeLessThan(0.5);
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
    const transformer = baseTransformer(400, 100, 4); // Ucc=4%

    const result = calc.calculateScenario(nodes, cables, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 100, 100, transformer, 'polyphase_equilibre', 0, undefined);
    const cab = result.cables[0];
    expect(cab.current_A!).toBeGreaterThan(40);
    expect(cab.current_A!).toBeLessThan(60);
    expect(cab.voltageDrop_V!).toBeGreaterThan(2.0); // ~3.3 V câble
    expect(result.virtualBusbar).toBeTruthy();
    // Chute transfo attendue positive en magnitude et négative en signe pour prélèvement
    if (result.virtualBusbar) {
      expect(result.virtualBusbar.deltaU_V).toBeLessThan(0); // prélèvement => signe négatif
      expect(Math.abs(result.virtualBusbar.deltaU_V)).toBeGreaterThan(1.0);
    }
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
      expect(result.virtualBusbar.netSkVA).toBeLessThan(0); // injection nette
      expect(result.virtualBusbar.deltaU_V).toBeGreaterThan(0); // élévation de tension
    }
  });

  it('Cas 4: tensions monophasées correctes en 400V déséquilibré', () => {
    const calc = new ElectricalCalculator(1.0);
    const nodes: Node[] = [
      { id: 'src', name: 'Source', lat: 0, lng: 0, connectionType: 'TÉTRA_3P+N_230_400V', clients: [], productions: [], isSource: true },
      { id: 'n1', name: 'Mono1', lat: degLatForMeters(100), lng: 0, connectionType: 'MONO_230V_PN', clients: [{ id: 'c1', label: 'Load', S_kVA: 5 }], productions: [] },
      { id: 'n2', name: 'Tri1', lat: degLatForMeters(100), lng: degLatForMeters(50), connectionType: 'TÉTRA_3P+N_230_400V', clients: [{ id: 'c2', label: 'Load', S_kVA: 15 }], productions: [] },
    ];
    const cables: Cable[] = [
      { id: 'cab1', name: 'C1', typeId: 't1', pose: 'AÉRIEN', nodeAId: 'src', nodeBId: 'n1', coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(100), lng: 0 }] },
      { id: 'cab2', name: 'C2', typeId: 't1', pose: 'AÉRIEN', nodeAId: 'src', nodeBId: 'n2', coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(100), lng: degLatForMeters(50) }] }
    ];
    const cableTypes: CableType[] = [mkCableType('t1', 0.3, 0, 0.3, 0)];
    const transformer = baseTransformer(400, 100, 4);

    const result = calc.calculateScenario(nodes, cables, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 100, 100, transformer, 'monophase_reparti', 0, undefined);
    
    // Vérifier que les nœuds MONO_230V_PN affichent des tensions ~230V (pas ~400V)
    const monoMetrics = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'n1');
    const triMetrics = result.nodeMetricsPerPhase?.find(n => n.nodeId === 'n2');
    
    expect(monoMetrics).toBeTruthy();
    expect(triMetrics).toBeTruthy();
    
    if (monoMetrics) {
      // Nœud monophasé : tensions de phase ~230V ±10% (EN50160: 207V-253V)
      const maxPhaseVoltage = Math.max(monoMetrics.voltagesPerPhase.A, monoMetrics.voltagesPerPhase.B, monoMetrics.voltagesPerPhase.C);
      expect(maxPhaseVoltage).toBeGreaterThan(200); // minimum EN50160
      expect(maxPhaseVoltage).toBeLessThan(260); // maximum EN50160
    }
    
    if (triMetrics) {
      // Nœud triphasé : tensions composées ~400V ±10%
      const maxLineVoltage = Math.max(triMetrics.voltagesPerPhase.A, triMetrics.voltagesPerPhase.B, triMetrics.voltagesPerPhase.C);
      expect(maxLineVoltage).toBeGreaterThan(360); 
      expect(maxLineVoltage).toBeLessThan(440);
    }
  });

  it('Cas 5: réseau équilibré - courant neutre nul et tensions identiques en monophasé/polyphasé', () => {
    const calc = new ElectricalCalculator(1.0);
    
    // Configuration réseau équilibré : 3 charges identiques de 10 kVA réparties uniformément
    const nodes: Node[] = [
      { id: 'src', name: 'Source', lat: 0, lng: 0, connectionType: 'TÉTRA_3P+N_230_400V', clients: [], productions: [], isSource: true },
      { id: 'n1', name: 'Node1', lat: degLatForMeters(100), lng: 0, connectionType: 'TÉTRA_3P+N_230_400V', clients: [{ id: 'c1', label: 'Load1', S_kVA: 10 }], productions: [] },
    ];
    const cables: Cable[] = [
      { id: 'cab1', name: 'C1', typeId: 't1', pose: 'AÉRIEN', nodeAId: 'src', nodeBId: 'n1', coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(100), lng: 0 }] }
    ];
    const cableTypes: CableType[] = [mkCableType('t1', 0.3, 0.1, 0.3, 0.1)];
    const transformer = baseTransformer(400, 100, 4);

    // Répartition manuelle équilibrée (33.33% sur chaque phase)
    const equilibratedDistribution = { 
      charges: { A: 33.33, B: 33.33, C: 33.34 }, 
      productions: { A: 33.33, B: 33.33, C: 33.34 }
    };

    // Calcul en mode monophasé équilibré
    const resultMono = calc.calculateScenario(
      nodes, cables, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 
      100, 100, transformer, 'monophase_reparti', 0, equilibratedDistribution
    );

    // Calcul en mode polyphasé équilibré
    const resultPoly = calc.calculateScenario(
      nodes, cables, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 
      100, 100, transformer, 'polyphase_equilibre', 0, undefined
    );

    // Vérifications pour le mode monophasé équilibré
    const cableMono = resultMono.cables[0];
    const nodeMetricsMono = resultMono.nodeMetricsPerPhase?.find(n => n.nodeId === 'n1');

    // 1. Courant neutre doit être pratiquement nul (tolérance 0.1 A pour erreurs numériques)
    expect(cableMono.currentsPerPhase_A?.N ?? 0).toBeLessThan(0.1);

    // 2. Tensions des 3 phases doivent être pratiquement identiques (tolérance 0.1 V)
    if (nodeMetricsMono) {
      const voltages = [
        nodeMetricsMono.voltagesPerPhase.A,
        nodeMetricsMono.voltagesPerPhase.B,
        nodeMetricsMono.voltagesPerPhase.C
      ];
      const avgVoltage = (voltages[0] + voltages[1] + voltages[2]) / 3;
      const maxDeviation = Math.max(...voltages.map(v => Math.abs(v - avgVoltage)));
      expect(maxDeviation).toBeLessThan(0.1); // Tensions équilibrées à 0.1 V près
    }

    // 3. Comparaison mono/poly : tensions doivent être identiques (tolérance 0.5 V)
    const cablePoly = resultPoly.cables[0];
    const nodeMetricsPoly = resultPoly.nodeMetricsPerPhase?.find(n => n.nodeId === 'n1');
    
    if (nodeMetricsMono && nodeMetricsPoly) {
      const monoAvgVoltage = (
        nodeMetricsMono.voltagesPerPhase.A + 
        nodeMetricsMono.voltagesPerPhase.B + 
        nodeMetricsMono.voltagesPerPhase.C
      ) / 3;
      
      const polyAvgVoltage = (
        nodeMetricsPoly.voltagesPerPhase.A + 
        nodeMetricsPoly.voltagesPerPhase.B + 
        nodeMetricsPoly.voltagesPerPhase.C
      ) / 3;
      
      // Les tensions moyennes doivent être identiques entre mono et poly
      expect(Math.abs(monoAvgVoltage - polyAvgVoltage)).toBeLessThan(0.5);
    }

    // 4. Chute de tension doit être identique entre mono et poly (tolérance 0.1%)
    expect(Math.abs((cableMono.voltageDropPercent ?? 0) - (cablePoly.voltageDropPercent ?? 0))).toBeLessThan(0.1);
  });
});
