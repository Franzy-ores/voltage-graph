import { Node, Cable, Project, CalculationResult, CalculationScenario, ConnectionType, CableType, TransformerConfig, VirtualBusbar, LoadModel } from '@/types/network';
import { getConnectedNodes } from '@/utils/networkConnectivity';
import { Complex, C, add, sub, mul, div, conj, scale, abs, fromPolar } from '@/utils/complex';

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

  /**
   * Calcule le courant RMS par phase (A) à partir de la puissance apparente S_kVA.
   * Conventions:
   * - Triphasé: I = |S_kVA| * 1000 / (√3 · U_line)
   * - Monophasé: I = |S_kVA| * 1000 / U_phase
   * S_kVA est la puissance apparente totale (kVA), positive en consommation, négative en injection.
   * sourceVoltage, s'il est fourni, est interprété comme U_line (tri) ou U_phase (mono).
   */
  private calculateCurrentA(S_kVA: number, connectionType: ConnectionType, sourceVoltage?: number): number {
    let { U_base, isThreePhase } = this.getVoltage(connectionType);

    if (sourceVoltage) {
      U_base = sourceVoltage;
    }

    const Sabs_kVA = Math.abs(S_kVA);
    const denom = isThreePhase ? (Math.sqrt(3) * U_base) : U_base;
    if (!isFinite(denom) || denom <= 0) return 0;
    return (Sabs_kVA * 1000) / denom;
  }

  private getComplianceStatus(voltageDropPercent: number): 'normal'|'warning'|'critical' {
    const absP = Math.abs(voltageDropPercent);
    if (absP <= 8) return 'normal';
    if (absP <= 10) return 'warning';
    return 'critical';
  }

  // [Supprimé] Ancienne formule simplifiée de ΔU transfo basée sur cosφ.
  // Les calculs transfo sont désormais exclusivement phasoriels via Ztr_phase et I_source_net.


  // Calcul du jeu de barres virtuel (phasors) avec analyse par départ
  private calculateVirtualBusbar(
    transformerConfig: TransformerConfig,
    totalLoads_kVA: number,
    totalProductions_kVA: number,
    source: Node,
    children: Map<string, string[]>,
    S_aval: Map<string, number>,
    V_node: Map<string, Complex>,
    I_source_net: Complex,
    Ztr_phase: Complex | null,
    cableIndexByPair: Map<string, Cable>,
    I_source_net_phases?: { A: Complex; B: Complex; C: Complex } // Pour I_N en mode déséquilibré
  ): VirtualBusbar {
    const { U_base: U_nom_source, isThreePhase: isSourceThree } = this.getVoltage(source.connectionType);
    const U_ref_line = source.tensionCible ?? transformerConfig.nominalVoltage_V ?? U_nom_source;

    // Tension slack de référence (phasor)
    const Vslack = C(U_ref_line / (isSourceThree ? Math.sqrt(3) : 1), 0);

    // ΔV transfo (phasor) et tension bus source (phasor)
    const dVtr = Ztr_phase ? mul(Ztr_phase, I_source_net) : C(0, 0);
    const V_bus = sub(Vslack, dVtr);

    const busVoltage_V = abs(V_bus) * (isSourceThree ? Math.sqrt(3) : 1);
    const netSkVA = totalLoads_kVA - totalProductions_kVA;
    const busCurrent_A = abs(I_source_net);

    // Courant neutre du jeu de barres (si 400V et mode déséquilibré)
    const is400V = U_ref_line >= 350;
    let current_N: number | undefined;
    if (is400V && I_source_net_phases) {
      const I_N = add(add(I_source_net_phases.A, I_source_net_phases.B), I_source_net_phases.C);
      current_N = abs(I_N);
    }

    // ΔU global appliqué au bus (en V, ligne)
    const dVtr_line = abs(dVtr) * (isSourceThree ? Math.sqrt(3) : 1);
    const sign = netSkVA > 0 ? -1 : (netSkVA < 0 ? 1 : 0);
    const dVtr_line_signed = sign * dVtr_line;

    // Récupérer les départs (voisins directs de la source)
    const sourceChildren = children.get(source.id) || [];
    const circuits: VirtualBusbar['circuits'] = [];

    const collectSubtreeNodes = (rootId: string): string[] => {
      const res: string[] = [];
      const stack2 = [rootId];
      while (stack2.length) {
        const u = stack2.pop()!;
        res.push(u);
        for (const v of children.get(u) || []) stack2.push(v);
      }
      return res;
    };

    // Calculer cosφ effectif pour Q
    const cosPhi_eff = Math.min(1, Math.max(0, this.cosPhi));
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi_eff * cosPhi_eff));

    for (const childId of sourceChildren) {
      const subtreeSkVA = S_aval.get(childId) || 0;
      const direction: 'injection' | 'prélèvement' = subtreeSkVA < 0 ? 'injection' : 'prélèvement';

      // Calcul de Q du circuit (kVAr)
      const subtreeQkVAr = Math.abs(subtreeSkVA) * sinPhi * Math.sign(subtreeSkVA);

      const cableId = cableIndexByPair.get(`${source.id}|${childId}`)?.id
        ?? cableIndexByPair.get(`${childId}|${source.id}`)?.id
        ?? 'unknown';

      // Courant du départ (approx. à partir de S et tension bus)
      const departCurrent_A = this.calculateCurrentA(subtreeSkVA, source.connectionType, busVoltage_V);

      // Part de ΔU transfo allouée proportionnellement à la puissance du sous-arbre
      const voltageShare = netSkVA !== 0 ? (dVtr_line_signed * (subtreeSkVA / netSkVA)) : 0;

      // Min/Max des tensions dans le sous-arbre à partir des phasors calculés
      const subtreeNodes = collectSubtreeNodes(childId);
      let minNodeVoltage = Number.POSITIVE_INFINITY;
      let maxNodeVoltage = Number.NEGATIVE_INFINITY;
      for (const nid of subtreeNodes) {
        const nV = V_node.get(nid);
        if (!nV) continue;
        // Conversion ligne/phase basée sur le type de connexion (fallback: type de la source)
        const nodeConnType: ConnectionType = nid === source.id
          ? source.connectionType
          : source.connectionType;
        const isThree = this.getVoltage(nodeConnType).isThreePhase;
        const U_node_line = abs(nV) * (isThree ? Math.sqrt(3) : 1);
        if (U_node_line < minNodeVoltage) minNodeVoltage = U_node_line;
        if (U_node_line > maxNodeVoltage) maxNodeVoltage = U_node_line;
      }
      if (subtreeNodes.length === 0 || !isFinite(minNodeVoltage)) {
        const U_node_line = abs(V_bus) * (isSourceThree ? Math.sqrt(3) : 1);
        minNodeVoltage = U_node_line;
        maxNodeVoltage = U_node_line;
      }

      circuits.push({
        circuitId: cableId,
        subtreeSkVA,
        subtreeQkVAr,
        direction,
        current_A: departCurrent_A,
        deltaU_V: voltageShare,
        voltageBus_V: busVoltage_V,
        minNodeVoltage_V: minNodeVoltage,
        maxNodeVoltage_V: maxNodeVoltage,
        nodesCount: subtreeNodes.length
      });
    }

    return {
      voltage_V: busVoltage_V,
      current_A: busCurrent_A,
      current_N,
      netSkVA,
      deltaU_V: dVtr_line_signed,
      deltaU_percent: U_ref_line ? (dVtr_line_signed / U_ref_line) * 100 : 0,
      losses_kW: (abs(I_source_net) ** 2) * (Ztr_phase?.re || 0) * (isSourceThree ? 3 : 1) / 1000,
      circuits
    };
  }

  // ---- calcul d'un scénario ----
  calculateScenario(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario,
    foisonnementCharges: number = 100,
    foisonnementProductions: number = 100,
    transformerConfig?: TransformerConfig,
    loadModel: LoadModel = 'polyphase_equilibre',
    desequilibrePourcent: number = 0
  ): CalculationResult {
    console.log('🔄 calculateScenario started for scenario:', scenario, 'with nodes:', nodes.length, 'cables:', cables.length);
    const nodeById = new Map(nodes.map(n => [n.id, n] as const));
    const cableTypeById = new Map(cableTypes.map(ct => [ct.id, ct] as const));

    const sources = nodes.filter(n => n.isSource);
    console.log('🔄 Found sources:', sources.length);
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

    // ---- Power Flow using Backward-Forward Sweep (complex R+jX) ----
    // Build helper indices
    const cableIndexByPair = new Map<string, (typeof cables)[number]>();
    for (const cab of cables) {
      const key1 = `${cab.nodeAId}|${cab.nodeBId}`;
      const key2 = `${cab.nodeBId}|${cab.nodeAId}`;
      cableIndexByPair.set(key1, cab);
      cableIndexByPair.set(key2, cab);
    }

    const parentCableOfChild = new Map<string, (typeof cables)[number]>();
    for (const [nodeId, p] of parent.entries()) {
      if (!p) continue;
      const cab = cableIndexByPair.get(`${p}|${nodeId}`);
      if (cab) parentCableOfChild.set(nodeId, cab);
    }

    // Per-cable per-phase impedance (Ω)
    const cableZ_phase = new Map<string, Complex>();
    const cableChildId = new Map<string, string>();
    const cableParentId = new Map<string, string>();

    for (const [childId, cab] of parentCableOfChild.entries()) {
      const parentId = parent.get(childId)!;
      const distalNode = nodeById.get(childId)!;
      const ct = cableTypeById.get(cab.typeId);
      if (!ct) throw new Error(`Cable type ${cab.typeId} introuvable`);
      const length_m = this.calculateLengthMeters(cab.coordinates || []);
      const L_km = length_m / 1000;

      const { R: R_ohm_per_km, X: X_ohm_per_km } = this.selectRX(ct, distalNode.connectionType);
      // Series impedance per phase for the full segment
      const Z = C(R_ohm_per_km * L_km, X_ohm_per_km * L_km);
      cableZ_phase.set(cab.id, Z);
      cableChildId.set(cab.id, childId);
      cableParentId.set(cab.id, parentId);
    }

    // Node complex powers (per phase) and initial voltages
    const S_node_total_kVA = new Map<string, number>(); // signed (charges>0, productions<0)
    for (const n of nodes) {
      S_node_total_kVA.set(n.id, S_eq.get(n.id) || 0);
    }

    const VcfgSrc = this.getVoltage(source.connectionType);
    let U_line_base = VcfgSrc.U_base;
    if (transformerConfig?.nominalVoltage_V) U_line_base = transformerConfig.nominalVoltage_V;
    if (source.tensionCible) U_line_base = source.tensionCible;
    const isSrcThree = VcfgSrc.isThreePhase;

    if (!isFinite(U_line_base) || U_line_base <= 0) {
      console.warn('⚠️ U_line incohérent pour la source, utilisation d\'une valeur par défaut.', { U_line_base, connectionType: source.connectionType });
      U_line_base = isSrcThree ? 400 : 230;
    }

    const Vslack_phase = U_line_base / (isSrcThree ? Math.sqrt(3) : 1);
    const Vslack = C(Vslack_phase, 0);

    // Transformer series impedance (per phase)
    let Ztr_phase: Complex | null = null;
    if (transformerConfig) {
      // Ztr (Ω/phase) à partir de Ucc% (en p.u.) et du ratio X/R si fourni
      const Zpu = transformerConfig.shortCircuitVoltage_percent / 100;
      const Sbase_VA = transformerConfig.nominalPower_kVA * 1000;
      // Zbase (Ω) en utilisant U_ligne^2 / Sbase, cohérent avec un modèle par phase
      const Zbase = (U_line_base * U_line_base) / (Sbase_VA * Math.sqrt(3)); // Ω
      const Zmag = Zpu * Zbase; // |Z|

      const xOverR = transformerConfig.xOverR;
      let R = 0;
      let X = 0;
      if (typeof xOverR === 'number' && isFinite(xOverR) && xOverR > 0) {
        // R = Z / sqrt(1 + (X/R)^2), X = R * (X/R)
        R = Zmag / Math.sqrt(1 + xOverR * xOverR);
        X = R * xOverR;
      } else {
        // Fallback par défaut si X/R inconnu
        R = 0.05 * Zmag;
        X = Math.sqrt(Math.max(0, Zmag * Zmag - R * R));
      }
      Ztr_phase = C(R, X);
    }

    const V_node = new Map<string, Complex>();
    for (const n of nodes) V_node.set(n.id, Vslack);

    // Sécurité: cosΦ dans [0,1]
    const cosPhi_eff = Math.min(1, Math.max(0, this.cosPhi));
    if (!isFinite(this.cosPhi) || this.cosPhi < 0 || this.cosPhi > 1) {
      console.warn('⚠️ cosΦ hors [0,1], application d\'un clamp.', { cosPhi_in: this.cosPhi, cosPhi_eff });
    }
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi_eff * cosPhi_eff));

    // ---- Mode déséquilibré (monophasé réparti) -> calcul triphasé par phase ----
    const d = Math.max(0, Math.min(1, (desequilibrePourcent || 0) / 100));
    const isUnbalanced = loadModel === 'monophase_reparti' && d > 0;

    if (isUnbalanced) {
      // Répartition S_total -> S_A/S_B/S_C selon d (appliqué sur L1/A)
      // Pivot global fixe : phase A pour 400V, paire L1-L2 pour 230V  
      const globalAngle = 0; // Angle identique pour tous les circuits pour préserver la notion de circuit
      
      const pA = (1 / 3) * (1 + d);
      const rem = Math.max(0, 1 - pA);
      const pB = rem / 2;
      const pC = rem / 2;

      const S_A_map = new Map<string, Complex>();
      const S_B_map = new Map<string, Complex>();
      const S_C_map = new Map<string, Complex>();

      for (const n of nodes) {
        const S_kVA_tot = S_node_total_kVA.get(n.id) || 0; // signé
        const sign = Math.sign(S_kVA_tot) || 1;
        const S_A_kVA = S_kVA_tot * pA;
        const S_B_kVA = S_kVA_tot * pB;
        const S_C_kVA = S_kVA_tot * pC;
        const P_A_kW = S_A_kVA * cosPhi_eff;
        const Q_A_kVAr = Math.abs(S_A_kVA) * sinPhi * sign;
        const P_B_kW = S_B_kVA * cosPhi_eff;
        const Q_B_kVAr = Math.abs(S_B_kVA) * sinPhi * sign;
        const P_C_kW = S_C_kVA * cosPhi_eff;
        const Q_C_kVAr = Math.abs(S_C_kVA) * sinPhi * sign;
        S_A_map.set(n.id, C(P_A_kW * 1000, Q_A_kVAr * 1000));
        S_B_map.set(n.id, C(P_B_kW * 1000, Q_B_kVAr * 1000));
        S_C_map.set(n.id, C(P_C_kW * 1000, Q_C_kVAr * 1000));
      }

      const runBFSForPhase = (angleDeg: number, S_map: Map<string, Complex>) => {
        const V_node_phase = new Map<string, Complex>();
        const I_branch_phase = new Map<string, Complex>();
        const I_inj_node_phase = new Map<string, Complex>();

        const Vslack_phase_ph = fromPolar(Vslack_phase, this.deg2rad(angleDeg));
        for (const n of nodes) V_node_phase.set(n.id, Vslack_phase_ph);

        let iter2 = 0;
        let converged2 = false;
        while (iter2 < 100) {
          iter2++;
          const V_prev2 = new Map(V_node_phase);

          I_branch_phase.clear();
          I_inj_node_phase.clear();

          for (const n of nodes) {
            const Vn = V_node_phase.get(n.id) || Vslack_phase_ph;
            const Sph = S_map.get(n.id) || C(0, 0);
            const Vsafe = abs(Vn) > 1e-6 ? Vn : Vslack_phase_ph;
            const Iinj = conj(div(Sph, Vsafe));
            I_inj_node_phase.set(n.id, Iinj);
          }

          for (const u of postOrder) {
            if (u === source.id) continue;
            const childrenIds = children.get(u) || [];
            let I_sum = C(0, 0);
            for (const v of childrenIds) {
              const cabChild = parentCableOfChild.get(v);
              if (!cabChild) continue;
              const Ichild = I_branch_phase.get(cabChild.id) || C(0, 0);
              I_sum = add(I_sum, Ichild);
            }
            I_sum = add(I_sum, I_inj_node_phase.get(u) || C(0, 0));
            const cab = parentCableOfChild.get(u);
            if (cab) I_branch_phase.set(cab.id, I_sum);
          }

          let I_source_net = C(0, 0);
          for (const v of children.get(source.id) || []) {
            const cab = parentCableOfChild.get(v);
            if (!cab) continue;
            I_source_net = add(I_source_net, I_branch_phase.get(cab.id) || C(0, 0));
          }
          I_source_net = add(I_source_net, I_inj_node_phase.get(source.id) || C(0, 0));

          const V_source_bus = Ztr_phase ? sub(Vslack_phase_ph, mul(Ztr_phase, I_source_net)) : Vslack_phase_ph;
          V_node_phase.set(source.id, V_source_bus);

          const stack2 = [source.id];
          while (stack2.length) {
            const u = stack2.pop()!;
            for (const v of children.get(u) || []) {
              const cab = parentCableOfChild.get(v);
              if (!cab) continue;
              const Z = cableZ_phase.get(cab.id) || C(0, 0);
              const Iuv = I_branch_phase.get(cab.id) || C(0, 0);
              const Vu = V_node_phase.get(u) || Vslack_phase_ph;
              const Vv = sub(Vu, mul(Z, Iuv));
              V_node_phase.set(v, Vv);
              stack2.push(v);
            }
          }

          // Convergence per-phase
          let maxDelta = 0;
          for (const [nid, Vn] of V_node_phase.entries()) {
            const Vp = V_prev2.get(nid) || Vslack_phase_ph;
            const d = abs(sub(Vn, Vp));
            if (d > maxDelta) maxDelta = d;
          }
          if (maxDelta / (Vslack_phase || 1) < 1e-4) { converged2 = true; break; }
        }
        if (!converged2) {
          console.warn(`⚠️ BFS phase ${angleDeg}° non convergé`);
        }
        return { V_node_phase, I_branch_phase };
      };

      // Pivot global : même angle (0°) pour tous les circuits pour préserver la notion de circuit
      const phaseA = runBFSForPhase(globalAngle, S_A_map);
      const phaseB = runBFSForPhase(globalAngle, S_B_map);
      const phaseC = runBFSForPhase(globalAngle, S_C_map);

      // Compose cable results (par phase)
      calculatedCables.length = 0;
      globalLosses = 0;
      const is400V = U_line_base >= 350; // heuristique

      for (const cab of cables) {
        const childId = cableChildId.get(cab.id);
        const parentId = cableParentId.get(cab.id);
        const length_m = this.calculateLengthMeters(cab.coordinates || []);
        const ct = cableTypeById.get(cab.typeId);
        if (!ct) throw new Error(`Cable type ${cab.typeId} introuvable`);

        const distalId = childId && parentId ? childId : (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeBId : cab.nodeAId);
        const distalNode = nodeById.get(distalId)!;
        const { isThreePhase } = this.getVoltage(distalNode.connectionType);
        const Z = cableZ_phase.get(cab.id) || C(0, 0);

        const IA = phaseA.I_branch_phase.get(cab.id) || C(0, 0);
        const IB = phaseB.I_branch_phase.get(cab.id) || C(0, 0);
        const IC = phaseC.I_branch_phase.get(cab.id) || C(0, 0);

        const IA_mag = abs(IA);
        const IB_mag = abs(IB);
        const IC_mag = abs(IC);

        const dVA = abs(mul(Z, IA));
        const dVB = abs(mul(Z, IB));
        const dVC = abs(mul(Z, IC));

        const current_A = Math.max(IA_mag, IB_mag, IC_mag);
        const deltaU_line_V = Math.max(dVA, dVB, dVC) * (isThreePhase ? Math.sqrt(3) : 1);

        // Base voltage for percent
        let { U_base } = this.getVoltage(distalNode.connectionType);
        const srcTarget = nodes.find(n => n.isSource)?.tensionCible;
        if (srcTarget) U_base = srcTarget;
        const deltaU_percent = U_base ? (deltaU_line_V / U_base) * 100 : 0;

        // Pertes (somme des 3 phases)
        const R_total = Z.re;
        const losses_kW = ((IA_mag*IA_mag) + (IB_mag*IB_mag) + (IC_mag*IC_mag)) * R_total / 1000;
        globalLosses += losses_kW;

        // Courant de neutre (si 400V L-N)
        const IN_mag = is400V ? abs(add(add(IA, IB), IC)) : 0;

        calculatedCables.push({
          ...cab,
          length_m,
          current_A,
          voltageDrop_V: deltaU_line_V,
          voltageDropPercent: deltaU_percent,
          losses_kW,
          apparentPower_kVA: undefined,
          currentsPerPhase_A: { A: IA_mag, B: IB_mag, C: IC_mag, N: is400V ? IN_mag : undefined },
          voltageDropPerPhase_V: { A: dVA, B: dVB, C: dVC }
        });
      }

      // Tension nodale (pire phase) et conformité
      let worstAbsPct = 0;
      const nodeVoltageDrops: { nodeId: string; deltaU_cum_V: number; deltaU_cum_percent: number }[] = [];
      const nodePhasorsPerPhase: { nodeId: string; phase: 'A'|'B'|'C'; V_real: number; V_imag: number; V_phase_V: number; V_angle_deg: number }[] = [];

      const sourceNode = nodes.find(n => n.isSource);
      for (const n of nodes) {
        // Récupération des tensions nodales par phase avec même angle global (préservation des circuits)
        const Va = phaseA.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        const Vb = phaseB.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        const Vc = phaseC.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        const Va_mag = abs(Va);
        const Vb_mag = abs(Vb);
        const Vc_mag = abs(Vc);

        nodePhasorsPerPhase.push(
          { nodeId: n.id, phase: 'A', V_real: Va.re, V_imag: Va.im, V_phase_V: Va_mag, V_angle_deg: (Math.atan2(Va.im, Va.re)*180)/Math.PI },
          { nodeId: n.id, phase: 'B', V_real: Vb.re, V_imag: Vb.im, V_phase_V: Vb_mag, V_angle_deg: (Math.atan2(Vb.im, Vb.re)*180)/Math.PI },
          { nodeId: n.id, phase: 'C', V_real: Vc.re, V_imag: Vc.im, V_phase_V: Vc_mag, V_angle_deg: (Math.atan2(Vc.im, Vc.re)*180)/Math.PI },
        );

        const { isThreePhase } = this.getVoltage(n.connectionType);
        const U_node_line_worst = Math.min(Va_mag, Vb_mag, Vc_mag) * (isThreePhase ? Math.sqrt(3) : 1);

        let { U_base: U_ref_display } = this.getVoltage(n.connectionType);
        if (sourceNode?.tensionCible) U_ref_display = sourceNode.tensionCible;

        const deltaU_V = U_ref_display - U_node_line_worst;
        const deltaU_pct = U_ref_display ? (deltaU_V / U_ref_display) * 100 : 0;

        const { U_base: U_nom } = this.getVoltage(n.connectionType);
        const deltaU_pct_nominal = U_nom ? ((U_nom - U_node_line_worst) / U_nom) * 100 : 0;
        const absPctNom = Math.abs(deltaU_pct_nominal);
        if (absPctNom > worstAbsPct) worstAbsPct = absPctNom;

        nodeVoltageDrops.push({ nodeId: n.id, deltaU_cum_V: deltaU_V, deltaU_cum_percent: deltaU_pct });
      }

      const compliance = this.getComplianceStatus(worstAbsPct);

      // Calcul du jeu de barres virtuel (préserver la notion de circuit en monophasé déséquilibré)
      let virtualBusbar: VirtualBusbar | undefined;
      if (transformerConfig) {
        // Courant net à la source par phase pour I_N
        let I_source_net_A = C(0, 0);
        let I_source_net_B = C(0, 0);
        let I_source_net_C = C(0, 0);
        
        for (const v of children.get(source.id) || []) {
          const cab = parentCableOfChild.get(v);
          if (!cab) continue;
          I_source_net_A = add(I_source_net_A, phaseA.I_branch_phase.get(cab.id) || C(0, 0));
          I_source_net_B = add(I_source_net_B, phaseB.I_branch_phase.get(cab.id) || C(0, 0));
          I_source_net_C = add(I_source_net_C, phaseC.I_branch_phase.get(cab.id) || C(0, 0));
        }
        
        const V_source_A = phaseA.V_node_phase.get(source.id) || fromPolar(Vslack_phase, this.deg2rad(0));
        const S_source_A = S_A_map.get(source.id) || C(0, 0);
        const S_source_B = S_B_map.get(source.id) || C(0, 0);
        const S_source_C = S_C_map.get(source.id) || C(0, 0);
        
        const Iinj_A = conj(div(S_source_A, V_source_A));
        const Iinj_B = conj(div(S_source_B, V_source_A)); // Même tension ref
        const Iinj_C = conj(div(S_source_C, V_source_A)); // Même tension ref
        
        I_source_net_A = add(I_source_net_A, Iinj_A);
        I_source_net_B = add(I_source_net_B, Iinj_B);
        I_source_net_C = add(I_source_net_C, Iinj_C);

        virtualBusbar = this.calculateVirtualBusbar(
          transformerConfig,
          totalLoads,
          totalProductions,
          source,
          children,
          S_aval,
          phaseA.V_node_phase,
          I_source_net_A,
          Ztr_phase,
          cableIndexByPair,
          { A: I_source_net_A, B: I_source_net_B, C: I_source_net_C }
        );
      }

      const result: CalculationResult = {
        scenario,
        cables: calculatedCables,
        totalLoads_kVA: totalLoads,
        totalProductions_kVA: totalProductions,
        globalLosses_kW: Number(globalLosses.toFixed(6)),
        maxVoltageDropPercent: Number(worstAbsPct.toFixed(6)),
        maxVoltageDropCircuitNumber: undefined,
        compliance,
        nodeVoltageDrops,
        nodeMetrics: undefined,
        nodePhasors: undefined,
        nodePhasorsPerPhase,
        cablePowerFlows: undefined,
        virtualBusbar
      };

      return result;
    }

    // ---- Mode équilibré (inchangé) ----
    // Helper: per-node per-phase complex power in VA (signed)
    const S_node_phase_VA = new Map<string, Complex>();
    const computeNodeS = () => {
      S_node_phase_VA.clear();
      for (const n of nodes) {
        const S_kVA = S_node_total_kVA.get(n.id) || 0; // S_total (kVA), signé: >0 charge, <0 injection
        const P_kW = S_kVA * cosPhi_eff;
        const Q_kVAr = Math.abs(S_kVA) * sinPhi * Math.sign(S_kVA);
        const S_VA_total = C(P_kW * 1000, Q_kVAr * 1000);
        const { isThreePhase } = this.getVoltage(n.connectionType);
        const divisor = isThreePhase ? 3 : 1;
        S_node_phase_VA.set(n.id, scale(S_VA_total, 1 / divisor));
      }
    };
    computeNodeS();

    // Iterative BFS
    const maxIter = 100;
    const tol = 1e-4;
    let iter = 0;
    let converged = false;

    // Storage
    const I_branch = new Map<string, Complex>(); // by cable id (per phase)
    const I_inj_node = new Map<string, Complex>();

    while (iter < maxIter) {
      iter++;
      const V_prev = new Map(V_node);

      // Backward: compute injection currents then branch currents bottom-up
      I_branch.clear();
      I_inj_node.clear();

      for (const n of nodes) {
        const Vn = V_node.get(n.id) || Vslack;
        const Sph = S_node_phase_VA.get(n.id) || C(0, 0);
        const Vsafe = abs(Vn) > 1e-6 ? Vn : Vslack;
        // I = conj(S / V)
        const Iinj = conj(div(Sph, Vsafe));
        I_inj_node.set(n.id, Iinj);
      }

      for (const u of postOrder) {
        if (u === source.id) continue;
        const childrenIds = children.get(u) || [];
        let I_sum = C(0, 0);
        for (const v of childrenIds) {
          const cabChild = parentCableOfChild.get(v);
          if (!cabChild) continue;
          const Ichild = I_branch.get(cabChild.id) || C(0, 0);
          I_sum = add(I_sum, Ichild);
        }
        I_sum = add(I_sum, I_inj_node.get(u) || C(0, 0));
        const cab = parentCableOfChild.get(u);
        if (cab) I_branch.set(cab.id, I_sum);
      }

      // Current entering the source bus from network
      let I_source_net = C(0, 0);
      for (const v of children.get(source.id) || []) {
        const cab = parentCableOfChild.get(v);
        if (!cab) continue;
        I_source_net = add(I_source_net, I_branch.get(cab.id) || C(0, 0));
      }
      I_source_net = add(I_source_net, I_inj_node.get(source.id) || C(0, 0));

      // Forward: propagate voltages from slack through transformer and along feeders
      const V_source_bus = Ztr_phase ? sub(Vslack, mul(Ztr_phase, I_source_net)) : Vslack;
      V_node.set(source.id, V_source_bus);

      const stack2 = [source.id];
      while (stack2.length) {
        const u = stack2.pop()!;
        for (const v of children.get(u) || []) {
          const cab = parentCableOfChild.get(v);
          if (!cab) continue;
          const Z = cableZ_phase.get(cab.id) || C(0, 0);
          const Iuv = I_branch.get(cab.id) || C(0, 0);
          const Vu = V_node.get(u) || Vslack;
          const Vv = sub(Vu, mul(Z, Iuv));
          V_node.set(v, Vv);
          stack2.push(v);
        }
      }

      // Convergence check
      let maxDelta = 0;
      for (const [nid, Vn] of V_node.entries()) {
        const Vp = V_prev.get(nid) || Vslack;
        const d = abs(sub(Vn, Vp));
        if (d > maxDelta) maxDelta = d;
      }
      if (maxDelta / (Vslack_phase || 1) < tol) { converged = true; break; }
    }
    if (!converged) {
      console.warn('⚠️ Backward–Forward Sweep non convergé (tol=1e-4, maxIter=100). Les résultats peuvent être approximatifs.');
    }

    // Compose cable results from final branch currents and voltages
    calculatedCables.length = 0;
    globalLosses = 0;

    for (const cab of cables) {
      const childId = cableChildId.get(cab.id);
      const parentId = cableParentId.get(cab.id);
      const length_m = this.calculateLengthMeters(cab.coordinates || []);
      const L_km = length_m / 1000;
      const ct = cableTypeById.get(cab.typeId);
      if (!ct) throw new Error(`Cable type ${cab.typeId} introuvable`);

      // Determine distal node (child) for connection type
      const distalId = childId && parentId ? childId : (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeBId : cab.nodeAId);
      const distalNode = nodeById.get(distalId)!;
      const { isThreePhase } = this.getVoltage(distalNode.connectionType);

      // Per-phase Z
      let Z = cableZ_phase.get(cab.id);
      if (!Z) {
        // In case edge is not in the tree (shouldn't happen in radial), compute on the fly
        const { R: R_ohm_per_km, X: X_ohm_per_km } = this.selectRX(ct, distalNode.connectionType);
        Z = C(R_ohm_per_km * L_km, X_ohm_per_km * L_km);
      }

      const Iph = I_branch.get(cab.id) || C(0, 0);
      const dVph = mul(Z!, Iph);
      const current_A = abs(Iph);
      const deltaU_line_V = abs(dVph) * (isThreePhase ? Math.sqrt(3) : 1);

      // Base voltage for percent: prefer source target voltage if provided
      let { U_base } = this.getVoltage(distalNode.connectionType);
      const srcTarget = nodes.find(n => n.isSource)?.tensionCible;
      if (srcTarget) U_base = srcTarget;
      const deltaU_percent = U_base ? (deltaU_line_V / U_base) * 100 : 0;

      // Apparent power through the branch (kVA), computed at sending end (parent)
      const parentIdForCab = parentId ?? (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeAId : cab.nodeBId);
      const Vu = V_node.get(parentIdForCab || cab.nodeAId) || Vslack;
      const S_flow_phase = mul(Vu, conj(Iph)); // VA per phase (complex)
      const phaseFactor = isThreePhase ? 3 : 1;
      const apparentPower_kVA = (abs(S_flow_phase) * phaseFactor) / 1000;

      const R_total = Z!.re; // per phase
      const losses_kW = (current_A * current_A * R_total * phaseFactor) / 1000;

      globalLosses += losses_kW;

      calculatedCables.push({
        ...cab,
        length_m,
        current_A,
        voltageDrop_V: deltaU_line_V,
        voltageDropPercent: deltaU_percent,
        losses_kW,
        apparentPower_kVA
      });
    }

    // ---- Évaluation nodale basée sur les phasors V_node ----
    // On n'additionne plus les |ΔV| câble par câble ; on compare |V_node| à une référence U_ref
    let worstAbsPct = 0;
    const nodeVoltageDrops: { nodeId: string; deltaU_cum_V: number; deltaU_cum_percent: number }[] = [];

    const sourceNode = nodes.find(n => n.isSource);
    for (const n of nodes) {
      const Vn = V_node.get(n.id) || Vslack;
      const { isThreePhase } = this.getVoltage(n.connectionType);
      const U_node_line = abs(Vn) * (isThreePhase ? Math.sqrt(3) : 1);

      // Référence d'affichage: tension cible source si fournie, sinon base de ce type de connexion
      let { U_base: U_ref_display } = this.getVoltage(n.connectionType);
      if (sourceNode?.tensionCible) U_ref_display = sourceNode.tensionCible;

      const deltaU_V = U_ref_display - U_node_line;
      const deltaU_pct = U_ref_display ? (deltaU_V / U_ref_display) * 100 : 0;

      // Référence nominale (conformité): 400V pour tétra, sinon 230V (équivalent via getVoltage)
      const { U_base: U_nom } = this.getVoltage(n.connectionType);
      const deltaU_pct_nominal = U_nom ? ((U_nom - U_node_line) / U_nom) * 100 : 0;
      const absPctNom = Math.abs(deltaU_pct_nominal);
      if (absPctNom > worstAbsPct) worstAbsPct = absPctNom;

      nodeVoltageDrops.push({
        nodeId: n.id,
        deltaU_cum_V: deltaU_V,
        deltaU_cum_percent: deltaU_pct
      });
    }

    const compliance = this.getComplianceStatus(worstAbsPct);

    // ---- VIRTUAL BUSBAR : calcul détaillé PAR DÉPART ----
    let virtualBusbar: VirtualBusbar | undefined;
    if (transformerConfig) {
      // Recalcule du courant net source après convergence
      let I_source_net_final = C(0, 0);
      for (const v of children.get(source.id) || []) {
        const cab = parentCableOfChild.get(v);
        if (!cab) continue;
        I_source_net_final = add(I_source_net_final, I_branch.get(cab.id) || C(0, 0));
      }
      I_source_net_final = add(I_source_net_final, I_inj_node.get(source.id) || C(0, 0));

      virtualBusbar = this.calculateVirtualBusbar(
        transformerConfig,
        totalLoads,
        totalProductions,
        source,
        children,
        S_aval,
        V_node,
        I_source_net_final,
        Ztr_phase,
        cableIndexByPair
      );

      console.log('✅ Virtual busbar calculated (phasor-based, per-depart):', virtualBusbar);
    }

    // ---- Node metrics (V_phase and p.u., I_inj per node) ----
    const nodeMetrics = nodes.map(n => {
      const Vn = V_node.get(n.id) || Vslack;
      const { isThreePhase, U_base: U_nom_line } = this.getVoltage(n.connectionType);
      const V_phase_V = abs(Vn);
      const V_nom_phase = U_nom_line / (isThreePhase ? Math.sqrt(3) : 1);
      const V_pu = V_nom_phase ? V_phase_V / V_nom_phase : 0;
      const Iinj = I_inj_node.get(n.id) || C(0, 0);
      return { nodeId: n.id, V_phase_V, V_pu, I_inj_A: abs(Iinj) };
    });

    // ---- Export phasors nodaux pour debug/analyse ----
    const nodePhasors = nodes.map(n => {
      const Vn = V_node.get(n.id) || Vslack;
      const V_angle_deg = (Math.atan2(Vn.im, Vn.re) * 180) / Math.PI;
      return {
        nodeId: n.id,
        V_real: Vn.re,
        V_imag: Vn.im,
        V_phase_V: abs(Vn),
        V_angle_deg
      };
    });

    // ---- Export flux de puissance P/Q par tronçon ----
    const cablePowerFlows = calculatedCables.map(cab => {
      const childId = cableChildId.get(cab.id);
      const parentId = cableParentId.get(cab.id);
      const distalId = childId && parentId ? childId : (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeBId : cab.nodeAId);
      const distalNode = nodeById.get(distalId)!;
      const { isThreePhase } = this.getVoltage(distalNode.connectionType);

      // Courant et tension au départ du tronçon
      const Iph = I_branch.get(cab.id) || C(0, 0);
      const parentIdForCab = parentId ?? (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeAId : cab.nodeBId);
      const Vu = V_node.get(parentIdForCab || cab.nodeAId) || Vslack;
      
      // Puissance complexe par phase : S = V * I*
      const S_phase = mul(Vu, conj(Iph));
      const phaseFactor = isThreePhase ? 3 : 1;
      
      const P_kW = (S_phase.re * phaseFactor) / 1000;
      const Q_kVAr = (S_phase.im * phaseFactor) / 1000;
      const S_kVA = (abs(S_phase) * phaseFactor) / 1000;
      const pf = S_kVA > 1e-6 ? Math.abs(P_kW / S_kVA) : 1; // facteur de puissance

      return {
        cableId: cab.id,
        P_kW: Number(P_kW.toFixed(3)),
        Q_kVAr: Number(Q_kVAr.toFixed(3)),
        S_kVA: Number(S_kVA.toFixed(3)),
        pf: Number(pf.toFixed(3))
      };
    });

    // ---- Déterminer le circuit avec la chute maximale ----
    let maxVoltageDropCircuitNumber: number | undefined;
    if (virtualBusbar?.circuits) {
      let worstDropPercent = 0;
      for (const circuit of virtualBusbar.circuits) {
        const circuitNodes = new Set<string>();
        // Trouver tous les nœuds de ce circuit
        const mainCircuitCables = cables.filter(c => c.id === circuit.circuitId);
        for (const cable of mainCircuitCables) {
          circuitNodes.add(cable.nodeAId);
          circuitNodes.add(cable.nodeBId);
        }
        
        // Trouver la pire chute dans ce circuit
        for (const nodeId of circuitNodes) {
          const nodeVoltageDrop = nodeVoltageDrops.find(nvd => nvd.nodeId === nodeId);
          if (nodeVoltageDrop) {
            const absPct = Math.abs(nodeVoltageDrop.deltaU_cum_percent);
            if (absPct > worstDropPercent) {
              worstDropPercent = absPct;
              // Déterminer le numéro de circuit
              const sourceNode = nodes.find(n => n.isSource);
              if (sourceNode) {
                const mainCircuitCables = cables
                  .filter(cable => cable.nodeAId === sourceNode.id || cable.nodeBId === sourceNode.id)
                  .sort((a, b) => a.id.localeCompare(b.id));
                const circuitIndex = mainCircuitCables.findIndex(cable => cable.id === circuit.circuitId);
                maxVoltageDropCircuitNumber = circuitIndex >= 0 ? circuitIndex + 1 : undefined;
              }
            }
          }
        }
      }
    }

    console.log('🔄 Creating result object...');
    const result: CalculationResult = {
      scenario,
      cables: calculatedCables,
      totalLoads_kVA: totalLoads,
      totalProductions_kVA: totalProductions,
      globalLosses_kW: Number(globalLosses.toFixed(6)),
      maxVoltageDropPercent: Number(worstAbsPct.toFixed(6)),
      maxVoltageDropCircuitNumber,
      compliance,
      nodeVoltageDrops,
      nodeMetrics,
      nodePhasors,
      cablePowerFlows,
      virtualBusbar
    };

    console.log('✅ calculateScenario completed successfully for scenario:', scenario);
    return result;
  }
}
