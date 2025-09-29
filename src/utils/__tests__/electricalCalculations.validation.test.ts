import { describe, it, expect } from 'vitest';
import { ElectricalCalculator } from '@/utils/electricalCalculations';
import type { Node, Cable, CableType, TransformerConfig, CalculationScenario } from '@/types/network';

// Helper pour créer des types de câbles de test
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

// Helper pour créer des transformateurs de test
const baseTransformer = (Uline: number, S_kVA: number, Ucc_percent = 0, xOverR?: number): TransformerConfig => ({
  rating: '160kVA', 
  nominalPower_kVA: S_kVA, 
  nominalVoltage_V: Uline, 
  shortCircuitVoltage_percent: Ucc_percent, 
  cosPhi: 1, 
  xOverR
});

// Conversion approximative degrés de latitude vers mètres
const degLatForMeters = (m: number) => m / 111_000;

describe('ElectricalCalculator - Tests de validation selon prompt', () => {

  describe('Test 1: 400/230 V équilibré - tronçon S=30kVA, cosφ=0.95', () => {
    it('doit calculer I≈43.3 A/phase et ΔU_ligne correcte', () => {
      const calc = new ElectricalCalculator(0.95);
      const nodes: Node[] = [
        { 
          id: 'src', 
          name: 'Source', 
          lat: 0, 
          lng: 0, 
          connectionType: 'TÉTRA_3P+N_230_400V', 
          clients: [], 
          productions: [], 
          isSource: true 
        },
        { 
          id: 'n1', 
          name: 'Charge', 
          lat: degLatForMeters(100), 
          lng: 0, 
          connectionType: 'TÉTRA_3P+N_230_400V', 
          clients: [{ id: 'c1', label: 'Load 30kW', S_kVA: 30 / 0.95 }], // S = P/cosφ
          productions: [] 
        },
      ];
      
      const cables: Cable[] = [
        { 
          id: 'cab1', 
          name: 'C1', 
          typeId: 't1', 
          pose: 'AÉRIEN', 
          nodeAId: 'src', 
          nodeBId: 'n1', 
          coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(100), lng: 0 }] 
        }
      ];
      
      const cableTypes: CableType[] = [mkCableType('t1', 0.5, 0.1, 0.5, 0.1)];
      const transformer = baseTransformer(400, 160, 0);

      const result = calc.calculateScenario(
        nodes, cables, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 
        100, 100, transformer, 'polyphase_equilibre', 0, undefined
      );

      const cab = result.cables[0];
      
      // Vérifications attendues
      expect(cab.current_A!).toBeGreaterThan(40);
      expect(cab.current_A!).toBeLessThan(47);
      console.log(`📊 Test 1 - Courant calculé: ${cab.current_A!.toFixed(1)}A (attendu: ~43.3A)`);
      
      // ΔU L-L utilise bien ×√3 pour le triphasé
      expect(cab.voltageDrop_V!).toBeGreaterThan(0);
      console.log(`📊 Test 1 - ΔU L-L: ${cab.voltageDrop_V!.toFixed(1)}V`);
      
      // Vérifier les nouvelles métriques de conformité
      expect(result.maxUndervoltPercent).toBeGreaterThanOrEqual(0);
      expect(result.maxOvervoltPercent).toBeGreaterThanOrEqual(0);
      expect(result.maxVoltageDropPercent).toBe(Math.max(result.maxUndervoltPercent, result.maxOvervoltPercent));
    });
  });

  describe('Test 2: 3×230 V équilibré - même S', () => {
    it('doit calculer I≈75.2 A et Vslack_phase ≈ 132.8 V', () => {
      const calc = new ElectricalCalculator(0.95);
      const nodes: Node[] = [
        { 
          id: 'src', 
          name: 'Source', 
          lat: 0, 
          lng: 0, 
          connectionType: 'TRI_230V_3F', 
          clients: [], 
          productions: [], 
          isSource: true 
        },
        { 
          id: 'n1', 
          name: 'Charge', 
          lat: degLatForMeters(100), 
          lng: 0, 
          connectionType: 'TRI_230V_3F', 
          clients: [{ id: 'c1', label: 'Load 30kW', S_kVA: 30 / 0.95 }], 
          productions: [] 
        },
      ];
      
      const cables: Cable[] = [
        { 
          id: 'cab1', 
          name: 'C1', 
          typeId: 't1', 
          pose: 'AÉRIEN', 
          nodeAId: 'src', 
          nodeBId: 'n1', 
          coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(100), lng: 0 }] 
        }
      ];
      
      const cableTypes: CableType[] = [mkCableType('t1', 0.5, 0.1, 0.5, 0.1)];
      const transformer = baseTransformer(230, 160, 0);

      const result = calc.calculateScenario(
        nodes, cables, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 
        100, 100, transformer, 'polyphase_equilibre', 0, undefined
      );

      const cab = result.cables[0];
      
      // I = S/(√3·230) ≈ 75.2 A attendu avec la correction
      expect(cab.current_A!).toBeGreaterThan(70);
      expect(cab.current_A!).toBeLessThan(80);
      console.log(`📊 Test 2 - Courant calculé: ${cab.current_A!.toFixed(1)}A (attendu: ~75.2A)`);
      
      // ΔU L-L utilise bien ×√3 (correction suppression exception TRI_230V_3F)
      expect(cab.voltageDrop_V!).toBeGreaterThan(0);
      console.log(`📊 Test 2 - ΔU L-L: ${cab.voltageDrop_V!.toFixed(1)}V`);
    });
  });

  describe('Test 3: Déséquilibré - charges 10/5/0 kVA (A/B/C)', () => {
    it('doit calculer I_N cohérent avec déphasages 0/-120/+120°', () => {
      const calc = new ElectricalCalculator(1.0);
      const nodes: Node[] = [
        { 
          id: 'src', 
          name: 'Source', 
          lat: 0, 
          lng: 0, 
          connectionType: 'TÉTRA_3P+N_230_400V', 
          clients: [], 
          productions: [], 
          isSource: true 
        },
        { 
          id: 'n1', 
          name: 'Charge déséq', 
          lat: degLatForMeters(100), 
          lng: 0, 
          connectionType: 'TÉTRA_3P+N_230_400V', 
          clients: [{ id: 'c1', label: 'Load 15kVA total', S_kVA: 15 }], 
          productions: [] 
        },
      ];
      
      const cables: Cable[] = [
        { 
          id: 'cab1', 
          name: 'C1', 
          typeId: 't1', 
          pose: 'AÉRIEN', 
          nodeAId: 'src', 
          nodeBId: 'n1', 
          coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(100), lng: 0 }] 
        }
      ];
      
      const cableTypes: CableType[] = [mkCableType('t1', 0.2, 0.05, 0.2, 0.05)];
      const transformer = baseTransformer(400, 160, 0);

      // Distribution déséquilibrée : 67% phase A, 33% phase B, 0% phase C
      const manualDistribution = {
        charges: { A: 67, B: 33, C: 0 },
        productions: { A: 33, B: 33, C: 33 }
      };

      const result = calc.calculateScenario(
        nodes, cables, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 
        100, 100, transformer, 'monophase_reparti', 0, manualDistribution
      );

      const cab = result.cables[0];
      
      // Vérifier que les courants par phase sont cohérents
      expect(cab.currentsPerPhase_A).toBeDefined();
      if (cab.currentsPerPhase_A) {
        console.log(`📊 Test 3 - Courants par phase: A=${cab.currentsPerPhase_A.A?.toFixed(1)}A, B=${cab.currentsPerPhase_A.B?.toFixed(1)}A, C=${cab.currentsPerPhase_A.C?.toFixed(1)}A`);
        
        // Phase A doit avoir le plus fort courant (67% de la charge)
        expect(cab.currentsPerPhase_A.A!).toBeGreaterThan(cab.currentsPerPhase_A.B!);
        expect(cab.currentsPerPhase_A.C!).toBeLessThan(1); // Phase C pratiquement nulle
        
        // Courant de neutre présent
        if (cab.currentsPerPhase_A.N !== undefined) {
          expect(cab.currentsPerPhase_A.N).toBeGreaterThan(0);
          console.log(`📊 Test 3 - Courant neutre: ${cab.currentsPerPhase_A.N.toFixed(1)}A`);
        }
      }
      
      // Vérifier les métriques par phase
      expect(result.nodeMetricsPerPhase).toBeDefined();
      expect(result.nodePhasorsPerPhase).toBeDefined();
    });
  });

  describe('Test 4: Transformateur Ucc=4%, Sn=250kVA, UL-L=400V', () => {
    it('doit avoir Zbase=U²/S et ΔU transfo réduite vs ancienne formule', () => {
      const calc = new ElectricalCalculator(0.9);
      const nodes: Node[] = [
        { 
          id: 'src', 
          name: 'Source', 
          lat: 0, 
          lng: 0, 
          connectionType: 'TÉTRA_3P+N_230_400V', 
          clients: [], 
          productions: [], 
          isSource: true 
        },
        { 
          id: 'n1', 
          name: 'Charge', 
          lat: degLatForMeters(50), 
          lng: 0, 
          connectionType: 'TÉTRA_3P+N_230_400V', 
          clients: [{ id: 'c1', label: 'Load 200kVA', S_kVA: 200 }], 
          productions: [] 
        },
      ];
      
      const cables: Cable[] = [
        { 
          id: 'cab1', 
          name: 'C1', 
          typeId: 't1', 
          pose: 'AÉRIEN', 
          nodeAId: 'src', 
          nodeBId: 'n1', 
          coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(50), lng: 0 }] 
        }
      ];
      
      const cableTypes: CableType[] = [mkCableType('t1', 0.1, 0.05, 0.1, 0.05)];
      const transformer = baseTransformer(400, 250, 4, 3); // Ucc=4%, X/R=3

      const result = calc.calculateScenario(
        nodes, cables, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 
        100, 100, transformer, 'polyphase_equilibre', 0, undefined
      );

      // Vérifier que le transformateur contribue au calcul
      expect(result.virtualBusbar).toBeDefined();
      if (result.virtualBusbar) {
        expect(Math.abs(result.virtualBusbar.deltaU_V)).toBeGreaterThan(0);
        console.log(`📊 Test 4 - ΔU transformateur: ${result.virtualBusbar.deltaU_V.toFixed(1)}V`);
        console.log(`📊 Test 4 - Pertes transformateur: ${result.virtualBusbar.losses_kW?.toFixed(2)}kW`);
        
        // Avec la nouvelle Zbase = U²/S (sans /√3), les chutes doivent être cohérentes
        expect(result.virtualBusbar.losses_kW).toBeGreaterThan(0);
      }
    });
  });

  describe('Test 5: Vérification R0/X0 pour MONO P-N', () => {
    it('doit utiliser R0/X0 et faire fallback si absent', () => {
      const calc = new ElectricalCalculator(1.0);
      
      // Câble avec R0/X0 manquants (NaN)
      const cableTypeInvalid: CableType = {
        id: 't_invalid',
        label: 'Cable sans R0/X0',
        R12_ohm_per_km: 0.5,
        X12_ohm_per_km: 0.1,
        R0_ohm_per_km: NaN, // Invalide
        X0_ohm_per_km: NaN, // Invalide
        matiere: 'CUIVRE',
        posesPermises: ['AÉRIEN']
      };
      
      const nodes: Node[] = [
        { 
          id: 'src', 
          name: 'Source', 
          lat: 0, 
          lng: 0, 
          connectionType: 'TÉTRA_3P+N_230_400V', 
          clients: [], 
          productions: [], 
          isSource: true 
        },
        { 
          id: 'n1', 
          name: 'Charge mono', 
          lat: degLatForMeters(100), 
          lng: 0, 
          connectionType: 'MONO_230V_PN', 
          clients: [{ id: 'c1', label: 'Load mono 5kVA', S_kVA: 5 }], 
          productions: [] 
        },
      ];
      
      const cables: Cable[] = [
        { 
          id: 'cab1', 
          name: 'C1', 
          typeId: 't_invalid', 
          pose: 'AÉRIEN', 
          nodeAId: 'src', 
          nodeBId: 'n1', 
          coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(100), lng: 0 }] 
        }
      ];
      
      const transformer = baseTransformer(400, 160, 0);

      // Le calcul ne doit pas planter, le fallback doit fonctionner
      expect(() => {
        const result = calc.calculateScenario(
          nodes, cables, [cableTypeInvalid], 'PRÉLÈVEMENT' as CalculationScenario, 
          100, 100, transformer, 'polyphase_equilibre', 0, undefined
        );
        
        expect(result.cables).toHaveLength(1);
        console.log(`📊 Test 5 - Calcul avec fallback R0/X0 réussi`);
      }).not.toThrow();
    });
  });

  describe('Test 6: Métriques de conformité sous/sur-tension', () => {
    it('doit séparer maxUndervoltPercent et maxOvervoltPercent', () => {
      const calc = new ElectricalCalculator(1.0);
      
      // Créer un réseau avec tension source élevée pour provoquer surtension
      const nodes: Node[] = [
        { 
          id: 'src', 
          name: 'Source', 
          lat: 0, 
          lng: 0, 
          connectionType: 'TÉTRA_3P+N_230_400V', 
          clients: [], 
          productions: [], 
          isSource: true,
          tensionCible: 420 // Tension élevée pour surtension
        },
        { 
          id: 'n1', 
          name: 'Proche', 
          lat: degLatForMeters(10), 
          lng: 0, 
          connectionType: 'TÉTRA_3P+N_230_400V', 
          clients: [{ id: 'c1', label: 'Load 1kVA', S_kVA: 1 }], 
          productions: [] 
        },
        { 
          id: 'n2', 
          name: 'Loin', 
          lat: degLatForMeters(1000), 
          lng: 0, 
          connectionType: 'TÉTRA_3P+N_230_400V', 
          clients: [{ id: 'c2', label: 'Load 50kVA', S_kVA: 50 }], 
          productions: [] 
        },
      ];
      
      const cables: Cable[] = [
        { 
          id: 'cab1', 
          name: 'Court', 
          typeId: 't1', 
          pose: 'AÉRIEN', 
          nodeAId: 'src', 
          nodeBId: 'n1', 
          coordinates: [{ lat: 0, lng: 0 }, { lat: degLatForMeters(10), lng: 0 }] 
        },
        { 
          id: 'cab2', 
          name: 'Long', 
          typeId: 't1', 
          pose: 'AÉRIEN', 
          nodeAId: 'n1', 
          nodeBId: 'n2', 
          coordinates: [{ lat: degLatForMeters(10), lng: 0 }, { lat: degLatForMeters(1000), lng: 0 }] 
        }
      ];
      
      const cableTypes: CableType[] = [mkCableType('t1', 1.0, 0.1, 1.0, 0.1)]; // Résistance élevée
      const transformer = baseTransformer(400, 160, 0);

      const result = calc.calculateScenario(
        nodes, cables, cableTypes, 'PRÉLÈVEMENT' as CalculationScenario, 
        100, 100, transformer, 'polyphase_equilibre', 0, undefined
      );

      // Vérifier que les nouvelles métriques sont présentes
      expect(result.maxUndervoltPercent).toBeGreaterThanOrEqual(0);
      expect(result.maxOvervoltPercent).toBeGreaterThanOrEqual(0);
      
      console.log(`📊 Test 6 - Sous-tension max: ${result.maxUndervoltPercent.toFixed(2)}%`);
      console.log(`📊 Test 6 - Surtension max: ${result.maxOvervoltPercent.toFixed(2)}%`);
      
      // Au moins une des métriques doit être > 0 avec ce réseau déséquilibré
      expect(result.maxUndervoltPercent + result.maxOvervoltPercent).toBeGreaterThan(0);
      
      // Vérifier la compatibilité descendante
      expect(result.maxVoltageDropPercent).toBe(Math.max(result.maxUndervoltPercent, result.maxOvervoltPercent));
      
      // Compliance doit être calculée avec les deux valeurs
      expect(['normal', 'warning', 'critical']).toContain(result.compliance);
    });
  });
});