import { CalculationResult, CalculationScenario, Node, Cable, CableType, TransformerConfig, LoadModel, Project } from '@/types/network';
import { ElectricalCalculator } from './electricalCalculations';
import { SimulationCalculator } from './simulationCalculator';

/**
 * Shared utility for executing all scenario calculations
 * Centralized calculation logic - NO other places should call calculateScenario directly
 */
export function executeAllScenarioCalculations(
  calculator: ElectricalCalculator,
  modifiedNodes: Node[],
  cables: Cable[],
  cableTypes: CableType[],
  foisonnementCharges: number,
  foisonnementProductions: number,
  transformerConfig: TransformerConfig | null,
  loadModel: LoadModel,
  desequilibrePourcent: number,
  manualPhaseDistribution?: { charges: {A:number;B:number;C:number}; productions: {A:number;B:number;C:number} }
): Record<CalculationScenario, CalculationResult> {

  return {
    PRÉLÈVEMENT: calculator.calculateScenario(
      modifiedNodes, cables, cableTypes, 'PRÉLÈVEMENT',
      foisonnementCharges, foisonnementProductions,
      transformerConfig, loadModel, desequilibrePourcent, manualPhaseDistribution
    ),
    MIXTE: calculator.calculateScenario(
      modifiedNodes, cables, cableTypes, 'MIXTE', 
      foisonnementCharges, foisonnementProductions,
      transformerConfig, loadModel, desequilibrePourcent, manualPhaseDistribution
    ),
    PRODUCTION: calculator.calculateScenario(
      modifiedNodes, cables, cableTypes, 'PRODUCTION',
      foisonnementCharges, foisonnementProductions, 
      transformerConfig, loadModel, desequilibrePourcent, manualPhaseDistribution
    ),
    FORCÉ: calculator.calculateScenario(
      modifiedNodes, cables, cableTypes, 'FORCÉ',
      foisonnementCharges, foisonnementProductions,
      transformerConfig, loadModel, desequilibrePourcent, manualPhaseDistribution
    )
  };
}

/**
 * Execute scenario calculations with forced mode handling
 * Handles FORCÉ scenario with proper simulation integration
 */
export function executeAllScenariosWithForcedMode(
  project: Project,
  calculator: ElectricalCalculator,
  simulationCalculator: SimulationCalculator,
  modifiedNodes: Node[]
): Record<CalculationScenario, CalculationResult> {
  
  // Standard scenarios
  const standardResults = executeAllScenarioCalculations(
    calculator,
    modifiedNodes,
    project.cables,
    project.cableTypes,
    project.foisonnementCharges,
    project.foisonnementProductions,
    project.transformerConfig,
    project.loadModel ?? 'polyphase_equilibre',
    project.desequilibrePourcent ?? 0,
    project.manualPhaseDistribution
  );
  
  // FORCÉ scenario with special handling
  let forcedResult: CalculationResult;
  
  if (project.forcedModeConfig) {
    try {
      const simResult = simulationCalculator.calculateWithSimulation(
        project,
        'FORCÉ',
        { srg2: null, neutralCompensators: [], cableUpgrades: [] }
      );
      forcedResult = simResult.baselineResult || simResult;
    } catch (error) {
      console.error('Erreur simulation mode FORCÉ:', error);
      // Fallback to standard calculation
      forcedResult = standardResults.FORCÉ;
    }
  } else {
    forcedResult = standardResults.FORCÉ;
  }
  
  return {
    ...standardResults,
    FORCÉ: forcedResult
  };
}