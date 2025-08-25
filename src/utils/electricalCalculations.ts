import { Node, Cable, Project, CalculationResult, CalculationScenario, ConnectionType, CableType } from '@/types/network';
import { getConnectedNodes } from '@/utils/networkConnectivity';

export class ElectricalCalculator {
  private cosPhi: number;

  constructor(cosPhi: number = 0.95) {
    this.cosPhi = cosPhi;
  }

  setCosPhi(value: number) {
    this.cosPhi = value;
  }

  // ---- utilitaires ----
  private deg2rad(deg: number) { return deg * Math.PI / 180; }

  static calculateGeodeticDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  static calculateCableLength(coordinates: { lat:number; lng:number }[]): number {
    if (!coordinates || coordinates.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < coordinates.length; i++) {
      total += ElectricalCalculator.calculateGeodeticDistance(
        coordinates[i-1].lat, coordinates[i-1].lng,
        coordinates[i].lat, coordinates[i].lng
      );
    }
    return total;
  }

  calculateLengthMeters(coordinates: { lat:number; lng:number }[]): number {
    return ElectricalCalculator.calculateCableLength(coordinates);
  }

  private getVoltageConfig(connectionType: ConnectionType): { U: number; isThreePhase: boolean; useR0: boolean } {
    switch (connectionType) {
      case 'MONO_230V_PN':
        return { U: 230, isThreePhase: false, useR0: true };
      case 'MONO_230V_PP':
        return { U: 230, isThreePhase: false, useR0: false };
      case 'TRI_230V_3F':
        return { U: 230, isThreePhase: true, useR0: false };
      case 'TÉTRA_3P+N_230_400V':
        return { U: 400, isThreePhase: true, useR0: false };
      default:
        return { U: 230, isThreePhase: true, useR0: false };
    }
  }

  private getVoltage(connectionType: ConnectionType): { U_base:number, isThreePhase:boolean } {
    const { U, isThreePhase } = this.getVoltageConfig(connectionType);
    return { U_base: U, isThreePhase };
  }

  private selectRX(cableType: CableType, connectionType: ConnectionType): { R:number, X:number } {
    const { useR0 } = this.getVoltageConfig(connectionType);
    return useR0
      ? { R: cableType.R0_ohm_per_km, X: cableType.X0_ohm_per_km }
      : { R: cableType.R12_ohm_per_km, X: cableType.X12_ohm_per_km };
  }

  private calculateCurrentA(S_kVA: number, connectionType: ConnectionType, sourceVoltage?: number): number {
    let { U_base, isThreePhase } = this.getVoltage(connectionType);
    
    // Utiliser la tension source si fournie
    if (sourceVoltage) {
      U_base = sourceVoltage;
    }
    
    const denom = (isThreePhase ? Math.sqrt(3) * U_base : U_base) * this.cosPhi;
    if (denom === 0) return 0;
    return (S_kVA * 1000) / denom;
  }

  private getComplianceStatus(voltageDropPercent: number): 'normal'|'warning'|'critical' {
    const absP = Math.abs(voltageDropPercent);
    if (absP <= 8) return 'normal';
    if (absP <= 10) return 'warning';
    return 'critical';
  }

  // ---- calcul d'un scénario ----
  calculateScenario(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario,
    foisonnementCharges: number = 100,
    foisonnementProductions: number = 100
  ): CalculationResult {
    const nodeById = new Map(nodes.map(n => [n.id, n] as const));
    const cableTypeById = new Map(cableTypes.map(ct => [ct.id, ct] as const));

    const sources = nodes.filter(n => n.isSource);
    if (sources.length !== 1) throw new Error('Le réseau doit avoir exactement une source.');
    const source = sources[0];

    const adj = new Map<string, { cableId:string; neighborId:string }[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const cable of cables) {
      if (!nodeById.has(cable.nodeAId) || !nodeById.has(cable.nodeBId)) continue;
      adj.get(cable.nodeAId)!.push({ cableId:cable.id, neighborId:cable.nodeBId });
      adj.get(cable.nodeBId)!.push({ cableId:cable.id, neighborId:cable.nodeAId });
    }

    const parent = new Map<string, string | null>();
    const visited = new Set<string>();
    const queue: string[] = [source.id];
    parent.set(source.id, null);
    visited.add(source.id);

    while (queue.length) {
      const u = queue.shift()!;
      for (const edge of adj.get(u) || []) {
        if (!visited.has(edge.neighborId)) {
          visited.add(edge.neighborId);
          parent.set(edge.neighborId, u);
          queue.push(edge.neighborId);
        }
      }
    }

    const S_eq = new Map<string, number>();
    for (const n of nodes) {
      // Appliquer les facteurs de foisonnement
      const S_prel = (n.clients || []).reduce((s, c) => s + (c.S_kVA || 0), 0) * (foisonnementCharges / 100);
      const S_pv   = (n.productions || []).reduce((s, p) => s + (p.S_kVA || 0), 0) * (foisonnementProductions / 100);
      let val = 0;
      if (scenario === 'PRÉLÈVEMENT') val = S_prel;
      else if (scenario === 'PRODUCTION') val = - S_pv;
      else val = S_prel - S_pv;
      S_eq.set(n.id, val);
    }

    const children = new Map<string, string[]>();
    for (const n of nodes) children.set(n.id, []);
    for (const [nodeId, p] of parent.entries()) {
      if (p && children.has(p)) children.get(p)!.push(nodeId);
    }

    const postOrder: string[] = [];
    const dfs = (u: string) => {
      for (const v of children.get(u) || []) dfs(v);
      postOrder.push(u);
    };
    dfs(source.id);

    const S_aval = new Map<string, number>();
    for (const nodeId of postOrder) {
      let sum = S_eq.get(nodeId) || 0;
      for (const childId of (children.get(nodeId) || [])) {
        sum += S_aval.get(childId) || 0;
      }
      S_aval.set(nodeId, sum);
    }

    const calculatedCables: Cable[] = [];
    let globalLosses = 0;
    let totalLoads = 0;
    let totalProductions = 0;

    // Calculer les nœuds connectés à une source
    const connectedNodes = getConnectedNodes(nodes, cables);
    const connectedNodesData = nodes.filter(node => connectedNodes.has(node.id));

    for (const n of connectedNodesData) {
      // Appliquer les facteurs de foisonnement aux totaux aussi (seulement pour les nœuds connectés)
      totalLoads += (n.clients || []).reduce((s,c) => s + (c.S_kVA || 0), 0) * (foisonnementCharges / 100);
      totalProductions += (n.productions || []).reduce((s,p) => s + (p.S_kVA || 0), 0) * (foisonnementProductions / 100);
    }

    for (const cable of cables) {
      let distalNodeId: string | null = null;
      if (parent.get(cable.nodeBId) === cable.nodeAId) distalNodeId = cable.nodeBId;
      else if (parent.get(cable.nodeAId) === cable.nodeBId) distalNodeId = cable.nodeAId;
      else distalNodeId = cable.nodeBId;

      const distalS_kVA = S_aval.get(distalNodeId || cable.nodeBId) || 0;
      const ct = cableTypeById.get(cable.typeId);
      if (!ct) throw new Error(`Cable type ${cable.typeId} introuvable`);

      const length_m = this.calculateLengthMeters(cable.coordinates || []);
      const L_km = length_m / 1000;

      const distalNode = nodeById.get(distalNodeId || cable.nodeBId)!;
      const connectionType = distalNode.connectionType;

      const { R: R_ohm_per_km, X: X_ohm_per_km } = this.selectRX(ct, connectionType);
      const sinPhi = Math.sqrt(1 - this.cosPhi * this.cosPhi);

      // Trouver la source pour utiliser sa tension si définie
      const sourceNode = nodes.find(n => n.isSource);

      const I_A = this.calculateCurrentA(distalS_kVA, connectionType, sourceNode?.tensionCible);

      let { U_base, isThreePhase } = this.getVoltage(connectionType);
      
      // Utiliser la tension source si définie
      if (sourceNode?.tensionCible) {
        U_base = sourceNode.tensionCible;
      }
      
      const reactTerm = (R_ohm_per_km * this.cosPhi + X_ohm_per_km * sinPhi);
      const deltaU_V = (isThreePhase ? Math.sqrt(3) : 1) * I_A * reactTerm * L_km;
      const deltaU_percent = (deltaU_V / U_base) * 100;

      const R_total = R_ohm_per_km * L_km;
      const losses_kW = (I_A * I_A * R_total) / 1000;

      globalLosses += losses_kW;

      calculatedCables.push({
        ...cable,
        length_m,
        current_A: I_A,
        voltageDrop_V: deltaU_V,
        voltageDropPercent: deltaU_percent,
        losses_kW: losses_kW
      });
    }

    // ---- CUMUL ΔU par chemin ----
    const deltaUcum_V = new Map<string, number>();
    const deltaUcum_percent = new Map<string, number>();
    const deltaUcum_percent_nominal = new Map<string, number>(); // Pourcentage basé sur tension nominale pour conformité
    deltaUcum_V.set(source.id, 0);
    deltaUcum_percent.set(source.id, 0);
    deltaUcum_percent_nominal.set(source.id, 0);

    const parentCableOf = (u: string): (typeof calculatedCables)[number] | null => {
      const p = parent.get(u);
      if (!p) return null;
      return calculatedCables.find(c =>
        (c.nodeAId === p && c.nodeBId === u) || (c.nodeAId === u && c.nodeBId === p)
      ) || null;
    };

    const stack = [source.id];
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of children.get(u) || []) {
        const cab = parentCableOf(v);
        if (!cab) continue;

        const parentCumV = deltaUcum_V.get(u) || 0;
        const thisDeltaV = cab.voltageDrop_V || 0;
        const cumV = parentCumV + thisDeltaV;
        deltaUcum_V.set(v, cumV);

        let { U_base } = this.getVoltage((nodeById.get(v)!).connectionType);
        
        // Utiliser la tension source si définie pour le calcul du pourcentage cumulé (affichage)
        const sourceNode = nodes.find(n => n.isSource);
        if (sourceNode?.tensionCible) {
          U_base = sourceNode.tensionCible;
        }
        
        const cumPct = (cumV / U_base) * 100;
        deltaUcum_percent.set(v, cumPct);

        // Calculer le pourcentage basé sur la tension nominale pour la conformité
        const nominalVoltage = (nodeById.get(v)!).connectionType === 'TÉTRA_3P+N_230_400V' ? 400 : 230;
        const cumPctNominal = (cumV / nominalVoltage) * 100;
        deltaUcum_percent_nominal.set(v, cumPctNominal);

        stack.push(v);
      }
    }

    let worstAbsPct = 0;
    const nodeVoltageDrops: { nodeId: string; deltaU_cum_V: number; deltaU_cum_percent: number }[] = [];
    for (const n of nodes) {
      const pct = deltaUcum_percent.get(n.id) ?? 0;
      const pctNominal = deltaUcum_percent_nominal.get(n.id) ?? 0; // Pour la conformité
      const absPctNominal = Math.abs(pctNominal);
      nodeVoltageDrops.push({
        nodeId: n.id,
        deltaU_cum_V: deltaUcum_V.get(n.id) ?? 0,
        deltaU_cum_percent: pct // Affichage avec tension source
      });
      // Utiliser le pourcentage nominal pour déterminer la pire conformité
      if (absPctNominal > worstAbsPct) worstAbsPct = absPctNominal;
    }

    const compliance = this.getComplianceStatus(worstAbsPct);

    const result: CalculationResult = {
      scenario,
      cables: calculatedCables,
      totalLoads_kVA: totalLoads,
      totalProductions_kVA: totalProductions,
      globalLosses_kW: Number(globalLosses.toFixed(6)),
      maxVoltageDropPercent: Number(worstAbsPct.toFixed(6)),
      compliance,
      nodeVoltageDrops
    };

    return result;
  }
}
