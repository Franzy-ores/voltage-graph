import { describe, test, expect, beforeEach } from 'vitest';
import { SimulationCalculator } from '../simulationCalculator';
import { getSRG2ReferenceVoltage } from '../voltageReference';
import { calculateSRG2Regulation } from '../voltageDisplay';
import { Project, CalculationResult, CalculationScenario, VoltageSystem, LoadModel } from '@/types/network';

describe('SRG2 Voltage Reading Fix', () => {
  let calculator: SimulationCalculator;

  beforeEach(() => {
    calculator = new SimulationCalculator();
  });

  function createMockProject(voltageSystem: VoltageSystem, loadModel: LoadModel): Project {
    return {
      id: 'test-project',
      name: 'Test SRG2 Project',
      voltageSystem,
      loadModel,
      cosPhi: 0.95,
      foisonnementCharges: 100,
      foisonnementProductions: 100,
      defaultChargeKVA: 5,
      defaultProductionKVA: 5,
      nodes: [
        {
          id: 'source',
          name: 'Source',
          lat: 0,
          lng: 0,
          connectionType: voltageSystem === 'TRIPHASÉ_230V' ? 'TRI_230V_3F' : 'TÉTRA_3P+N_230_400V',
          isSource: true,
          tensionCible: voltageSystem === 'TRIPHASÉ_230V' ? 230 : 400,
          clients: [],
          productions: []
        },
        {
          id: 'node-srg2',
          name: 'SRG2 Node',
          lat: 0.001,
          lng: 0.001,
          connectionType: voltageSystem === 'TRIPHASÉ_230V' ? 'TRI_230V_3F' : 'TÉTRA_3P+N_230_400V',
          isSource: false,
          clients: [{ id: 'client1', label: 'Client 1', S_kVA: 10 }],
          productions: []
        }
      ],
      cables: [
        {
          id: 'cable1',
          name: 'Cable 1',
          typeId: 'default-cable',
          pose: 'SOUTERRAIN',
          nodeAId: 'source',
          nodeBId: 'node-srg2',
          coordinates: [
            { lat: 0, lng: 0 },
            { lat: 0.001, lng: 0.001 }
          ]
        }
      ],
      cableTypes: [
        {
          id: 'default-cable',
          label: 'Default 16mm²',
          R12_ohm_per_km: 1.15,
          X12_ohm_per_km: 0.1,
          R0_ohm_per_km: 3.4,
          X0_ohm_per_km: 0.4,
          matiere: 'CUIVRE',
          posesPermises: ['SOUTERRAIN', 'AÉRIEN']
        }
      ],
      transformerConfig: {
        rating: '160kVA',
        nominalPower_kVA: 160,
        nominalVoltage_V: voltageSystem === 'TRIPHASÉ_230V' ? 230 : 400,
        shortCircuitVoltage_percent: 4,
        cosPhi: 0.95
      }
    };
  }

  function createMockCalculationResult(voltageSystem: VoltageSystem, loadModel: LoadModel): CalculationResult {
    const isBalanced = loadModel === 'polyphase_equilibre';
    const is230V = voltageSystem === 'TRIPHASÉ_230V';
    
    if (isBalanced) {
      // For balanced mode, use nodeMetrics with V_phase_V
      const phaseVoltage = is230V ? 230 : 230; // Phase-neutral for 400V, line for 230V
      return {
        scenario: 'MIXTE',
        cables: [],
        totalLoads_kVA: 10.5,
        totalProductions_kVA: 0,
        globalLosses_kW: 0.1,
        maxVoltageDropPercent: 2.5,
        compliance: 'normal',
        nodeMetrics: [
          {
            nodeId: 'source',
            V_phase_V: is230V ? 230 : 400,
            V_pu: 1.0,
            I_inj_A: 0,
          },
          {
            nodeId: 'node-srg2',
            V_phase_V: phaseVoltage,
            V_pu: 0.975,
            I_inj_A: 15.2,
          }
        ]
      };
    } else {
      // For unbalanced mode, use nodeMetricsPerPhase
      const phaseA_V = is230V ? 133 : 220; // Phase-neutral voltages
      return {
        scenario: 'MIXTE',
        cables: [],
        totalLoads_kVA: 10.5,
        totalProductions_kVA: 0,
        globalLosses_kW: 0.1,
        maxVoltageDropPercent: 2.5,
        compliance: 'normal',
        nodeMetricsPerPhase: [
          {
            nodeId: 'source',
            voltagesPerPhase: { A: is230V ? 133 : 230, B: is230V ? 133 : 230, C: is230V ? 133 : 230 },
            voltageDropsPerPhase: { A: 0, B: 0, C: 0 },
            currentPerPhase: { A: 0, B: 0, C: 0 },
          },
          {
            nodeId: 'node-srg2',
            voltagesPerPhase: { A: phaseA_V, B: phaseA_V, C: phaseA_V },
            voltageDropsPerPhase: { A: -5.5, B: -5.5, C: -5.5 },
            currentPerPhase: { A: 15.2, B: 15.2, C: 15.2 },
          }
        ]
      };
    }
  }

  test('getSRG2ReferenceVoltage returns 230V for 230V triphasé balanced', () => {
    const project = createMockProject('TRIPHASÉ_230V', 'polyphase_equilibre');
    const result = createMockCalculationResult('TRIPHASÉ_230V', 'polyphase_equilibre');
    
    const srg2Voltage = getSRG2ReferenceVoltage('node-srg2', result, project);
    
    // Should convert 230V line to 230V phase-neutral reference for SRG2
    expect(srg2Voltage).toBeCloseTo(230, 0);
  });

  test('getSRG2ReferenceVoltage returns 230V for 400V tétra balanced', () => {
    const project = createMockProject('TÉTRAPHASÉ_400V', 'polyphase_equilibre');
    const result = createMockCalculationResult('TÉTRAPHASÉ_400V', 'polyphase_equilibre');
    
    const srg2Voltage = getSRG2ReferenceVoltage('node-srg2', result, project);
    
    // Should use 230V phase-neutral directly
    expect(srg2Voltage).toBeCloseTo(230, 0);
  });

  test('getSRG2ReferenceVoltage returns 230V for 230V triphasé unbalanced', () => {
    const project = createMockProject('TRIPHASÉ_230V', 'monophase_reparti');
    const result = createMockCalculationResult('TRIPHASÉ_230V', 'monophase_reparti');
    
    const srg2Voltage = getSRG2ReferenceVoltage('node-srg2', result, project);
    
    // Should convert phase voltage to 230V SRG2 reference
    expect(srg2Voltage).toBeCloseTo(230, 0);
  });

  test('getSRG2ReferenceVoltage returns 230V for 400V tétra unbalanced', () => {
    const project = createMockProject('TÉTRAPHASÉ_400V', 'monophase_reparti');
    const result = createMockCalculationResult('TÉTRAPHASÉ_400V', 'monophase_reparti');
    
    const srg2Voltage = getSRG2ReferenceVoltage('node-srg2', result, project);
    
    // Should scale phase-neutral voltage to 230V SRG2 reference
    expect(srg2Voltage).toBeCloseTo(230, 0);
  });

  test('getSRG2ReferenceVoltage fallback returns 230V when node not found', () => {
    const project = createMockProject('TÉTRAPHASÉ_400V', 'polyphase_equilibre');
    const result = createMockCalculationResult('TÉTRAPHASÉ_400V', 'polyphase_equilibre');
    
    const srg2Voltage = getSRG2ReferenceVoltage('non-existent-node', result, project);
    
    // Should fallback to 230V SRG2 reference
    expect(srg2Voltage).toBe(230);
  });

  test('SRG2 regulation detects low voltage correctly', () => {
    // Test voltage below BO2 threshold (207V)
    const { state, ratio } = calculateSRG2Regulation(200);
    
    expect(state).toBe('BO2');
    expect(ratio).toBeGreaterThan(1.0); // Boost ratio
  });

  test('SRG2 regulation detects high voltage correctly', () => {
    // Test voltage above LO2 threshold (253V)  
    const { state, ratio } = calculateSRG2Regulation(260);
    
    expect(state).toBe('LO2');
    expect(ratio).toBeLessThan(1.0); // Buck ratio
  });

  test('SRG2 regulation uses BYP for normal voltage', () => {
    // Test voltage in BYP range (218-241V)
    const { state, ratio } = calculateSRG2Regulation(230);
    
    expect(state).toBe('BYP');
    expect(ratio).toBe(1.0); // No regulation
  });

  test('SimulationCalculator uses unified SRG2 voltage reading', () => {
    const project = createMockProject('TÉTRAPHASÉ_400V', 'polyphase_equilibre');
    const scenario: CalculationScenario = 'MIXTE';
    
    const simulationEquipment = {
      srg2: {
        nodeId: 'node-srg2',
        enabled: true
      },
      neutralCompensators: [],
      cableUpgrades: []
    };

    // Should not throw and should return a simulation result
    const result = calculator.calculateWithSimulation(project, scenario, simulationEquipment);
    
    expect(result).toBeDefined();
    expect(result.srg2Result).toBeDefined();
    expect(result.srg2Result?.nodeId).toBe('node-srg2');
    expect(result.srg2Result?.originalVoltage).toBeCloseTo(230, 0); // Should use 230V reference
  });
});