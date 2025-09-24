import { CalculationResult, CalculationScenario, Node, Cable, CableType, TransformerConfig, LoadModel } from '@/types/network';
import { ElectricalCalculator } from './electricalCalculations';

/**
 * Shared utility for executing all scenario calculations
 * Eliminates code duplication in networkStore
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
      transformerConfig, loadModel, desequilibrePourcent, manualPhaseDistribution, false
    ),
    MIXTE: calculator.calculateScenario(
      modifiedNodes, cables, cableTypes, 'MIXTE', 
      foisonnementCharges, foisonnementProductions,
      transformerConfig, loadModel, desequilibrePourcent, manualPhaseDistribution, false
    ),
    PRODUCTION: calculator.calculateScenario(
      modifiedNodes, cables, cableTypes, 'PRODUCTION',
      foisonnementCharges, foisonnementProductions, 
      transformerConfig, loadModel, desequilibrePourcent, manualPhaseDistribution, false
    ),
    FORCÉ: calculator.calculateScenario(
      modifiedNodes, cables, cableTypes, 'FORCÉ',
      foisonnementCharges, foisonnementProductions,
      transformerConfig, loadModel, desequilibrePourcent, manualPhaseDistribution, false
    )
  };
}