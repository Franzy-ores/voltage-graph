import { ElectricalCalculator } from '@/utils/electricalCalculations'; // EXISTANT, NE PAS MODIFIER
import { computeBusbarEffect } from '@/utils/busbar';
import { Node, Cable, CableType, CalculationScenario } from '@/types/network';
import type { TransformerConfig } from '@/types/network';

export async function calculateWithBusbar(
  nodes: Node[],
  cables: Cable[],
  cableTypes: CableType[],
  transformer: TransformerConfig,
  cosPhi: number,
  scenario: CalculationScenario
) {
  // 1) Calcul capitalisant l'existant (réseau radial depuis la source) — AUCUNE modif
  const calc = new ElectricalCalculator(cosPhi);
  const base = calc.calculateScenario(nodes, cables, cableTypes, scenario);

  // 2) Offset commun TGBT (impact multi-départs)
  const busbar = computeBusbarEffect(transformer, nodes, cosPhi, scenario);

  // 3) On retourne les deux : l'UI combinera/affichera
  return { base, busbar };
}