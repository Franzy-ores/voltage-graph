import { ConnectionType, Node, Cable, CableType, CalculationScenario, CalculationResult } from '@/types/network';

/**
 * ElectricalCalculator
 * - prend en compte production comme charge négative
 * - calcule en parallèle les 3 scénarios (via le store) : PRÉLÈVEMENT / MIXTE / PRODUCTION
 * - choisit R/X (R12/X12 ou R0/X0) suivant le type de raccordement
 * - calcule les longueurs à partir de coordinates (m)
 */
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

  // distance géodésique en mètres (Haversine) - version statique pour compatibilité
  static calculateGeodeticDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // rayon terrestre en m
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // calcule la longueur d'une géométrie (coord array) en mètres - version statique pour compatibilité
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

  // version instance si nécessaire
  calculateLengthMeters(coordinates: { lat:number; lng:number }[]): number {
    return ElectricalCalculator.calculateCableLength(coordinates);
  }

  // retourne U utilisé selon ConnectionType (pour formule intensité)
  private getVoltage(connectionType: ConnectionType): { U_base:number, isThreePhase:boolean } {
    switch (connectionType) {
      case 'MONO_230V_PP':
        return { U_base: 230, isThreePhase: false };
      case 'TRI_230V_3F':
        return { U_base: 230, isThreePhase: true };
      case 'MONO_230V_PN':
        return { U_base: 230, isThreePhase: false };
      case 'TÉTRA_3P+N_230_400V':
        return { U_base: 400, isThreePhase: true };
      default:
        return { U_base: 230, isThreePhase: true };
    }
  }

  // sélectionne (R,X) selon le connectionType (utilise R12/X12 pour 3P/entre phases, R0/X0 pour PN)
  private selectRX(cableType: CableType, connectionType: ConnectionType): { R:number, X:number } {
    if (connectionType === 'MONO_230V_PN') {
      return { R: cableType.R0_ohm_per_km, X: cableType.X0_ohm_per_km };
    }
    // MONO_230V_PP, TRI_230V_3F, TÉTRA_3P+N_230_400V
    return { R: cableType.R12_ohm_per_km, X: cableType.X12_ohm_per_km };
  }

  // intensité I en A à partir de S_kVA (peut être négatif pour injection)
  private calculateCurrentA(S_kVA: number, connectionType: ConnectionType): number {
    const { U_base, isThreePhase } = this.getVoltage(connectionType);
    const denom = (isThreePhase ? Math.sqrt(3) * U_base : U_base) * this.cosPhi;
    if (denom === 0) return 0;
    return (S_kVA * 1000) / denom; // S_kVA peut être négatif
    }

  // conformité EN50160 pour ΔU% : vert <=8 ; orange <=10 ; rouge >10
  private getComplianceStatus(voltageDropPercent: number): 'normal'|'warning'|'critical' {
    const absP = Math.abs(voltageDropPercent);
    if (absP <= 8) return 'normal';
    if (absP <= 10) return 'warning';
    return 'critical';
  }

  // ---- calcul d'un scénario complet ----
  /**
   * nodes: liste des noeuds (doivent contenir id et listes charges/PV)
   * cables: liste des câbles avec nodeAId/nodeBId et coordinates
   * cableTypes: catalogue des types (id → R/X)
   * scenario: "PRÉLÈVEMENT" | "MIXTE" | "PRODUCTION"
   */
  calculateScenario(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario
  ): CalculationResult {
    // indexations utilitaires
    const nodeById = new Map(nodes.map(n => [n.id, n] as const));
    const cableTypeById = new Map(cableTypes.map(ct => [ct.id, ct] as const));

    // 1) vérifier source unique
    const sources = nodes.filter(n => n.isSource);
    if (sources.length === 0) throw new Error('Aucune source définie.');
    if (sources.length > 1) throw new Error('Plus d\'une source définie (doit être unique).');
    const source = sources[0];

    // 2) construire adjacency (graphe non orienté, orienté ensuite depuis la source)
    const adj = new Map<string, { cableId:string; neighborId:string }[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const cable of cables) {
      if (!nodeById.has(cable.nodeAId) || !nodeById.has(cable.nodeBId)) continue;
      adj.get(cable.nodeAId)!.push({ cableId:cable.id, neighborId:cable.nodeBId });
      adj.get(cable.nodeBId)!.push({ cableId:cable.id, neighborId:cable.nodeAId });
    }

    // 3) construire arbre orienté (BFS depuis source) et détecter cycles
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

    // vérification de cycles simples
    for (const cable of cables) {
      const a = cable.nodeAId, b = cable.nodeBId;
      if (visited.has(a) && visited.has(b)) {
        if (!(parent.get(b) === a || parent.get(a) === b)) {
          throw new Error('Cycle détecté dans le graphe. Le calcul attend un réseau radial (pas de cycles).');
        }
      }
    }

    // 4) calcul S_eq par noeud selon scenario
    const S_eq = new Map<string, number>();
    for (const n of nodes) {
      const S_prel = (n.clients || []).reduce((s, c) => s + (c.S_kVA || 0), 0);
      const S_pv   = (n.productions || []).reduce((s, p) => s + (p.S_kVA || 0), 0);
      let val = 0;
      if (scenario === 'PRÉLÈVEMENT') val = S_prel;
      else if (scenario === 'PRODUCTION') val = - S_pv;
      else val = S_prel - S_pv; // MIXTE
      S_eq.set(n.id, val);
    }

    // 5) post-order traversal pour sommer S_aval (descendants vers source)
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

    const S_aval = new Map<string, number>(); // puissance apparente aval (kVA)
    for (const nodeId of postOrder) {
      let sum = S_eq.get(nodeId) || 0;
      for (const childId of (children.get(nodeId) || [])) {
        sum += S_aval.get(childId) || 0;
      }
      S_aval.set(nodeId, sum);
    }

    // 6) pour chaque câble : I, ΔU, pertes en prenant la puissance aval au noeud distal (le fils)
    const calculatedCables: Cable[] = [];
    let globalLosses = 0;
    let maxVoltageDropPercent = 0;
    let totalLoads = 0;
    let totalProductions = 0;

    for (const n of nodes) {
      totalLoads += (n.clients || []).reduce((s,c) => s + (c.S_kVA || 0), 0);
      totalProductions += (n.productions || []).reduce((s,p) => s + (p.S_kVA || 0), 0);
    }

    for (const cable of cables) {
      // déterminer le noeud distal (éloigné de la source)
      let distalNodeId: string | null = null;
      if (parent.get(cable.nodeBId) === cable.nodeAId) distalNodeId = cable.nodeBId;
      else if (parent.get(cable.nodeAId) === cable.nodeBId) distalNodeId = cable.nodeAId;
      else {
        // arête hors arbre (composante non connexe / orientation inconnue) -> prendre celui qui a un parent si dispo
        if (parent.get(cable.nodeAId)) distalNodeId = cable.nodeAId; else distalNodeId = cable.nodeBId;
      }

      const distalS_kVA = S_aval.get(distalNodeId || cable.nodeBId) || 0; // peut être négatif

      const ct = cableTypeById.get(cable.typeId);
      if (!ct) throw new Error(`Cable type ${cable.typeId} introuvable pour cable ${cable.id}`);

      const length_m = this.calculateLengthMeters(cable.coordinates || []);
      const L_km = length_m / 1000;

      const distalNode = nodeById.get(distalNodeId || cable.nodeBId) || nodeById.get(cable.nodeBId) || nodeById.get(cable.nodeAId)!;
      const connectionType = distalNode.connectionType;

      const { R: R_ohm_per_km, X: X_ohm_per_km } = this.selectRX(ct, connectionType);
      const sinPhi = Math.sqrt(Math.max(0, 1 - this.cosPhi * this.cosPhi));

      const I_A_signed = this.calculateCurrentA(distalS_kVA, connectionType);
      const I_A = Math.abs(I_A_signed); // on conserve la norme pour affichage

      const { U_base, isThreePhase } = this.getVoltage(connectionType);
      let deltaU_V = 0;
      if (isThreePhase) {
        deltaU_V = Math.sqrt(3) * I_A * (R_ohm_per_km * this.cosPhi + X_ohm_per_km * sinPhi) * L_km;
      } else {
        deltaU_V = I_A * (R_ohm_per_km * this.cosPhi + X_ohm_per_km * sinPhi) * L_km;
      }
      // signe: injection -> deltaU négatif
      if (distalS_kVA < 0) deltaU_V = -deltaU_V;

      const deltaU_percent = (deltaU_V / U_base) * 100;

      const R_total = R_ohm_per_km * L_km;
      const losses_kW = (I_A * I_A * R_total) / 1000; // W -> kW

      globalLosses += losses_kW;
      maxVoltageDropPercent = Math.max(maxVoltageDropPercent, Math.abs(deltaU_percent));

      calculatedCables.push({
        ...cable,
        length_m,
        current_A: I_A,
        voltageDrop_V: deltaU_V,
        voltageDropPercent: deltaU_percent,
        losses_kW: losses_kW
      });
    }

    const compliance = this.getComplianceStatus(maxVoltageDropPercent);

    const result: CalculationResult = {
      scenario,
      cables: calculatedCables,
      totalLoads_kVA: totalLoads,
      totalProductions_kVA: totalProductions,
      globalLosses_kW: Number(globalLosses.toFixed(6)),
      maxVoltageDropPercent: Number(maxVoltageDropPercent.toFixed(6)),
      compliance
    };

    return result;
  }
}
