import { ConnectionType, Node } from '@/types/network';
import type { TransformerConfig, BusbarEffect } from '@/types/network';

function getVoltageConfig(connectionType: ConnectionType) {
  switch (connectionType) {
    case 'MONO_230V_PN':            return { U: 230, isThreePhase: false, useR0: true };
    case 'MONO_230V_PP':            return { U: 230, isThreePhase: false, useR0: false };
    case 'TRI_230V_3F':             return { U: 230, isThreePhase: true,  useR0: false };
    case 'TÉTRA_3P+N_230_400V':     return { U: 400, isThreePhase: true,  useR0: false };
    default:                        return { U: 230, isThreePhase: true,  useR0: false };
  }
}

// Somme des puissances selon scénario (charges - productions)
export function computeSNet_kVA(nodes: Node[], scenario: 'PRÉLÈVEMENT' | 'MIXTE' | 'PRODUCTION'): number {
  let S_load = 0, S_pv = 0;
  for (const n of nodes) {
    S_load += (n.clients || []).reduce((s, c) => s + (c.S_kVA || 0), 0);
    S_pv   += (n.productions || []).reduce((s, p) => s + (p.S_kVA || 0), 0);
  }
  if (scenario === 'PRÉLÈVEMENT') return S_load;
  if (scenario === 'PRODUCTION')  return -S_pv;
  return S_load - S_pv; // MIXTE
}

/**
 * Calcule l'offset de tension au jeu de barres (TGBT) vu depuis le transfo.
 * - N'emploie QUE l'impédance équivalente transfo+liaison (ohms par phase)
 * - Ne modifie PAS les calculs aval
 */
export function computeBusbarEffect(
  transformer: TransformerConfig,
  nodes: Node[],
  cosPhi: number,
  scenario: 'PRÉLÈVEMENT' | 'MIXTE' | 'PRODUCTION'
): BusbarEffect {
  const { U, isThreePhase, useR0 } = getVoltageConfig(transformer.connectionType);
  const S_total_kVA = computeSNet_kVA(nodes, scenario);

  // Sélection R/X (mono = R0/X0 si dispo, sinon R12/X12)
  const R = useR0 && transformer.R0_ohm != null ? transformer.R0_ohm : transformer.R12_ohm;
  const X = useR0 && transformer.X0_ohm != null ? transformer.X0_ohm : transformer.X12_ohm;

  const denom = (isThreePhase ? Math.sqrt(3) * U : U) * cosPhi;
  const I_abs = denom > 0 ? Math.abs(S_total_kVA * 1000 / denom) : 0;
  const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));

  // ΔU (toujours positif en valeur absolue)
  const deltaU_abs_V = (isThreePhase ? Math.sqrt(3) : 1) * I_abs * (R * cosPhi + X * sinPhi);

  // Signe : charge (S_total>=0) => chute, production (S_total<0) => élévation
  const deltaU_busbar_V = S_total_kVA >= 0 ? -deltaU_abs_V : +deltaU_abs_V;

  const U_busbar_V = U + deltaU_busbar_V;
  const deltaU_busbar_percent = (deltaU_busbar_V / U) * 100;

  return {
    U_nominal: U,
    U_busbar_V,
    deltaU_busbar_V,
    deltaU_busbar_percent,
    S_total_kVA
  };
}