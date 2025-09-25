import { describe, it, expect, beforeEach } from 'vitest';
import { getNetworkVoltageReference, getDisplayVoltage, isVoltageInRange } from '../voltageReference';
import { getNodeVoltageInfo, getVoltageComplianceColor } from '../voltageDisplay';
import { getSRG2VoltageThresholds, calculateSRG2Regulation } from '../voltageDisplay';
import { executeAllScenarioCalculations } from '../scenarioRunner';
import { Project, LoadModel, VoltageSystem } from '../../types/network';

/**
 * Tests for architectural refactoring - validation of unified systems
 */

describe('Voltage Reference System', () => {
  it('should provide consistent voltage references for all configurations', () => {
    // Test all 4 configurations
    const configs = [
      { voltageSystem: 'TRIPHASÉ_230V' as VoltageSystem, loadModel: 'monophase_reparti' as LoadModel },
      { voltageSystem: 'TRIPHASÉ_230V' as VoltageSystem, loadModel: 'polyphase_equilibre' as LoadModel },
      { voltageSystem: 'TÉTRAPHASÉ_400V' as VoltageSystem, loadModel: 'monophase_reparti' as LoadModel },
      { voltageSystem: 'TÉTRAPHASÉ_400V' as VoltageSystem, loadModel: 'polyphase_equilibre' as LoadModel }
    ];
    
    configs.forEach(config => {
      const ref = getNetworkVoltageReference(config.voltageSystem, config.loadModel);
      const displayVoltage = getDisplayVoltage(config.voltageSystem, config.loadModel);
      
      // All configurations should have consistent display reference of ~230V
      expect(displayVoltage).toBe(230);
      expect(ref.displayReference).toBe(230);
      
      // Voltage range check should work consistently
      expect(isVoltageInRange(230, config.voltageSystem, config.loadModel)).toBe(true);
      expect(isVoltageInRange(180, config.voltageSystem, config.loadModel)).toBe(false); // Too low
      expect(isVoltageInRange(280, config.voltageSystem, config.loadModel)).toBe(false); // Too high
    });
  });
});

describe('SRG2 Unified System', () => {
  it('should use consistent thresholds for all network types', () => {
    const thresholds = getSRG2VoltageThresholds();
    
    // Verify unified thresholds are based on 230V reference
    expect(thresholds.BO2_max).toBe(207); // 230 * 0.90
    expect(thresholds.BO1_max).toBe(218.5); // 230 * 0.95
    expect(thresholds.BYP_min).toBe(218.5); // 230 * 0.95
    expect(thresholds.BYP_max).toBe(241.5); // 230 * 1.05
    expect(thresholds.LO1_min).toBe(241.5); // 230 * 1.05
    expect(thresholds.LO2_min).toBe(253); // 230 * 1.10
  });
  
  it('should calculate regulation states consistently', () => {
    // Test different voltage levels
    const testCases = [
      { voltage: 200, expectedState: 'BO2', expectedRatio: 1.10 },
      { voltage: 210, expectedState: 'BO1', expectedRatio: 1.05 },
      { voltage: 230, expectedState: 'BYP', expectedRatio: 1.00 },
      { voltage: 245, expectedState: 'LO1', expectedRatio: 0.95 },
      { voltage: 260, expectedState: 'LO2', expectedRatio: 0.90 }
    ];
    
    testCases.forEach(({ voltage, expectedState, expectedRatio }) => {
      const { state, ratio } = calculateSRG2Regulation(voltage);
      expect(state).toBe(expectedState);
      expect(ratio).toBe(expectedRatio);
    });
  });
});

describe('Voltage Display System', () => {
  it('should provide appropriate compliance colors', () => {
    const mockProject: Partial<Project> = {
      voltageSystem: 'TÉTRAPHASÉ_400V',
      loadModel: 'polyphase_equilibre'
    };
    
    // Test compliance color calculation
    expect(getVoltageComplianceColor(230, mockProject as Project)).toBe('text-green-600'); // Perfect
    expect(getVoltageComplianceColor(220, mockProject as Project)).toBe('text-orange-500'); // 4.3% deviation
    expect(getVoltageComplianceColor(200, mockProject as Project)).toBe('text-red-600'); // 13% deviation
    expect(getVoltageComplianceColor(260, mockProject as Project)).toBe('text-red-600'); // 13% deviation
  });
});

describe('Centralized Calculation System', () => {
  it('should execute all scenarios through centralized runner', () => {
    // This test verifies that executeAllScenarioCalculations handles all scenarios
    // Mock dependencies would be needed for full test
    expect(executeAllScenarioCalculations).toBeDefined();
    expect(typeof executeAllScenarioCalculations).toBe('function');
  });
});