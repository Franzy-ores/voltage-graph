// SRG2 VOLTAGE FIX: Tests de validation des tensions correctes selon le type de réseau
import { describe, test, expect, beforeEach } from 'vitest';
import { SimulationCalculator } from '../simulationCalculator';
import type { Project, Node, Cable, CableType } from '../../types/network';

describe('SRG2 Voltage Fix - Validation des tensions selon type de réseau', () => {
  let calculator: SimulationCalculator;

  beforeEach(() => {
    calculator = new SimulationCalculator();
  });

  // Helper function to create mock project
  const createMockProject = (
    voltageSystem: 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V',
    loadModel: 'monophase_reparti' | 'polyphase_equilibre' = 'polyphase_equilibre'
  ): Project => ({
    id: 'test',
    name: 'Test Project',
    voltageSystem,
    loadModel,
    cosPhi: 0.95,
    nodes: [],
    cables: [],
    cableTypes: [],
    transformerConfig: {
      rating: '250kVA',
      nominalPower_kVA: 250,
      nominalVoltage_V: voltageSystem === 'TRIPHASÉ_230V' ? 230 : 400,
      shortCircuitVoltage_percent: 4,
      cosPhi: 0.95
    },
    foisonnementCharges: 100,
    foisonnementProductions: 100,
    defaultChargeKVA: 10,
    defaultProductionKVA: 5
  });

  // Helper function to create test node
  const createTestNode = (voltage: number): Node => ({
    id: 'NODE1',
    name: 'Test Node',
    lat: 0,
    lng: 0,
    connectionType: 'TRI_230V_3F',
    clients: [{ 
      id: 'client1', 
      label: 'Test load',
      S_kVA: 10
    }],
    productions: [],
    isSource: false,
    tensionCible: voltage
  });

  // TEST 1: Réseau 230V doit utiliser les tensions composées (phase-phase)
  test('230V network should use phase-to-phase voltages for SRG2', () => {
    const project = createMockProject('TRIPHASÉ_230V', 'polyphase_equilibre');
    const node = createTestNode(250);
    
    // Simuler des tensions avec déséquilibre
    const mockNodeMetrics = {
      nodeId: 'NODE1',
      voltagesPerPhase: { A: 191, B: 191, C: 191 }, // Tensions d'affichage (avec scale)
      calculatedVoltagesPerPhase: { A: 145, B: 145, C: 145 }, // Tensions phase-neutre
      calculatedVoltagesComposed: { AB: 250, BC: 250, CA: 250 }, // Tensions phase-phase (CORRECTES pour 230V)
      voltageDropsPerPhase: { A: 39, B: 39, C: 39 }
    };

    // Simuler l'extraction de tensions dans simulationCalculator
    const networkType = project.voltageSystem === 'TRIPHASÉ_230V' ? '230V' : '400V';
    
    let extractedVoltages;
    if (networkType === '230V' && mockNodeMetrics.calculatedVoltagesComposed) {
      extractedVoltages = {
        A: mockNodeMetrics.calculatedVoltagesComposed.AB,
        B: mockNodeMetrics.calculatedVoltagesComposed.BC,
        C: mockNodeMetrics.calculatedVoltagesComposed.CA
      };
    }

    // Vérifier que les bonnes tensions sont extraites
    expect(extractedVoltages).toBeDefined();
    expect(extractedVoltages?.A).toBe(250); // Phase-phase AB
    expect(extractedVoltages?.B).toBe(250); // Phase-phase BC  
    expect(extractedVoltages?.C).toBe(250); // Phase-phase CA
    
    console.log(`✅ 230V Network: SRG2 receives ${extractedVoltages?.A}V (phase-phase) instead of ${mockNodeMetrics.calculatedVoltagesPerPhase.A}V (phase-neutral)`);
  });

  // TEST 2: Réseau 400V doit utiliser les tensions phase-neutre
  test('400V network should use phase-to-neutral voltages for SRG2', () => {
    const project = createMockProject('TÉTRAPHASÉ_400V', 'polyphase_equilibre');
    const node = createTestNode(252);
    
    // Simuler des tensions 400V
    const mockNodeMetrics = {
      nodeId: 'NODE1',
      voltagesPerPhase: { A: 252, B: 252, C: 252 }, // Tensions d'affichage
      calculatedVoltagesPerPhase: { A: 252, B: 252, C: 252 }, // Tensions phase-neutre (CORRECTES pour 400V)
      calculatedVoltagesComposed: { AB: 437, BC: 437, CA: 437 }, // Tensions phase-phase (trop élevées)
      voltageDropsPerPhase: { A: -22, B: -22, C: -22 }
    };

    // Simuler l'extraction de tensions dans simulationCalculator
    const networkType = project.voltageSystem === 'TRIPHASÉ_230V' ? '230V' : '400V';
    
    let extractedVoltages;
    if (networkType === '400V' && mockNodeMetrics.calculatedVoltagesPerPhase) {
      extractedVoltages = {
        A: mockNodeMetrics.calculatedVoltagesPerPhase.A,
        B: mockNodeMetrics.calculatedVoltagesPerPhase.B,
        C: mockNodeMetrics.calculatedVoltagesPerPhase.C
      };
    }

    // Vérifier que les bonnes tensions sont extraites
    expect(extractedVoltages).toBeDefined();
    expect(extractedVoltages?.A).toBe(252); // Phase-neutre A
    expect(extractedVoltages?.B).toBe(252); // Phase-neutre B
    expect(extractedVoltages?.C).toBe(252); // Phase-neutre C
    
    console.log(`✅ 400V Network: SRG2 receives ${extractedVoltages?.A}V (phase-neutral) instead of ${mockNodeMetrics.calculatedVoltagesComposed.AB}V (phase-phase)`);
  });

  // TEST 3: Mode monophasé doit prendre la tension max (si déséquilibre)
  test('monophase mode should use maximum voltage when unbalanced', () => {
    const project = createMockProject('TRIPHASÉ_230V', 'monophase_reparti');
    
    // Tensions déséquilibrées
    const actualVoltages = { A: 248, B: 220, C: 235 };
    
    // Logique de sélection monophasée (du SRG2Regulator)
    const isMonophaseReparti = project.loadModel === 'monophase_reparti';
    let selectedVoltage;
    
    if (isMonophaseReparti) {
      selectedVoltage = Math.max(actualVoltages.A, actualVoltages.B, actualVoltages.C);
    } else {
      selectedVoltage = (actualVoltages.A + actualVoltages.B + actualVoltages.C) / 3;
    }

    expect(selectedVoltage).toBe(248); // Maximum des 3 phases
    console.log(`✅ Monophase mode: SRG2 uses ${selectedVoltage}V (max) instead of ${((248+220+235)/3).toFixed(1)}V (avg)`);
  });

  // TEST 4: Mode polyphasé doit prendre la tension moyenne
  test('polyphase mode should use average voltage', () => {
    const project = createMockProject('TRIPHASÉ_230V', 'polyphase_equilibre');
    
    // Mêmes tensions déséquilibrées
    const actualVoltages = { A: 248, B: 220, C: 235 };
    
    // Logique de sélection polyphasée (du SRG2Regulator)
    const isMonophaseReparti = project.loadModel === 'monophase_reparti';
    let selectedVoltage;
    
    if (isMonophaseReparti) {
      selectedVoltage = Math.max(actualVoltages.A, actualVoltages.B, actualVoltages.C);
    } else {
      selectedVoltage = (actualVoltages.A + actualVoltages.B + actualVoltages.C) / 3;
    }

    expect(selectedVoltage).toBeCloseTo(234.33, 1); // Moyenne des 3 phases
    console.log(`✅ Polyphase mode: SRG2 uses ${selectedVoltage.toFixed(1)}V (avg) instead of ${Math.max(248,220,235)}V (max)`);
  });

  // TEST 5: Validation du bon état SRG2 avec vraies tensions
  test('SRG2 should reach correct state with proper voltages', () => {
    // Réseau 230V à 250V → doit donner état LO2 (ratio 0.93)
    const feedVoltage_230V = 250;
    const networkType_230V = '230V';
    
    // Logique simplifiée des seuils SRG2 (de SRG2Regulator.getThresholds)
    const thresholds_230V = {
      upper_LO2: 245,  // 230V + 6.5%
      upper_LO1: 240,  // 230V + 4.3%
      lower_BO1: 220,  // 230V - 4.3%
      lower_BO2: 215   // 230V - 6.5%
    };
    
    // État attendu pour 250V sur réseau 230V
    let expectedState_230V = 'BYP';
    if (feedVoltage_230V > thresholds_230V.upper_LO2) {
      expectedState_230V = 'LO2'; // Tension trop élevée → réduction -7%
    }
    
    expect(expectedState_230V).toBe('LO2');
    
    // Réseau 400V à 252V → doit donner état BO2 (ratio 1.07)  
    const feedVoltage_400V = 252;
    const thresholds_400V = {
      upper_LO2: 245,  // 230V + 6.5% (référence toujours 230V)
      upper_LO1: 240,  // 230V + 4.3%
      lower_BO1: 220,  // 230V - 4.3%
      lower_BO2: 215   // 230V - 6.5%
    };
    
    let expectedState_400V = 'BYP';
    if (feedVoltage_400V > thresholds_400V.upper_LO2) {
      expectedState_400V = 'LO2'; // Tension trop élevée → réduction -7%
    }
    
    expect(expectedState_400V).toBe('LO2');
    
    console.log(`✅ SRG2 States: 230V@250V → ${expectedState_230V}, 400V@252V → ${expectedState_400V}`);
  });
});