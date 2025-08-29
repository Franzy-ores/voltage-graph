import { Node, Cable, Project, CalculationResult, CalculationScenario, ConnectionType, CableType, TransformerConfig, VirtualBusbar } from '@/types/network';
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

  // Calcul de la variation de tension du transformateur (signed)
  // netSkVA doit être exprimé comme: productions - charges
  private calculateTransformerVoltageShift(
    transformerConfig: TransformerConfig,
    netSkVA: number,
    baseVoltageOverride_V?: number
  ): number {
    console.log('🔧 calculateTransformerVoltageShift called with:', {
      netSkVA,
      baseVoltageOverride_V,
      transformerConfig: {
        rating: transformerConfig.rating,
        nominalPower_kVA: transformerConfig.nominalPower_kVA,
        nominalVoltage_V: transformerConfig.nominalVoltage_V,
        shortCircuitVoltage_percent: transformerConfig.shortCircuitVoltage_percent,
        cosPhi: transformerConfig.cosPhi
      }
    });

    const cosPhi = transformerConfig.cosPhi ?? this.cosPhi;
    const baseU = baseVoltageOverride_V ?? transformerConfig.nominalVoltage_V;
    const Sabs = Math.abs(netSkVA);
    const Snom = transformerConfig.nominalPower_kVA || 1;

    // |ΔU| = (Ucc%/100) * (|S|/S_nom) * baseU * cosφ
    const deltaU_abs =
      (transformerConfig.shortCircuitVoltage_percent / 100) *
      (Sabs / Snom) *
      baseU *
      cosPhi;

    // signe : + en injection (netSkVA > 0), - en prélèvement (netSkVA < 0)
    const sign = Math.sign(netSkVA) || 0;
    const result = sign * deltaU_abs;
    
    console.log('🔧 Transformer calculation result:', {
      cosPhi,
      baseU,
      Sabs,
      Snom,
      deltaU_abs,
      sign,
      result
    });
    
    return result;
  }

  // Calcul du jeu de barres virtuel avec analyse par départ
  private calculateVirtualBusbar(
    transformerConfig: TransformerConfig,
    netSkVA_total: number,
    source: Node,
    adj: Map<string, { cableId:string; neighborId:string }[]>,
    S_aval: Map<string, number>,
    children: Map<string, string[]>,
    deltaUcum_V: Map<string, number>
  ): VirtualBusbar {
    console.log('🔧 calculateVirtualBusbar called with:', {
      transformerRating: transformerConfig.rating,
      netSkVA_total,
      sourceId: source.id,
      sourceTensionCible: source.tensionCible,
      nominalVoltage: transformerConfig.nominalVoltage_V
    });

    // base tension = consigne source si fournie sinon tension nominale transformateur
    const baseU = source.tensionCible ?? transformerConfig.nominalVoltage_V;
    console.log('🔧 Base voltage:', baseU);

    // ΔU total du transformateur (signed)
    const voltageShift_total = this.calculateTransformerVoltageShift(transformerConfig, netSkVA_total, baseU);
    console.log('🔧 Voltage shift total:', voltageShift_total);

    // tension du jeu de barres
    const busVoltage = baseU + voltageShift_total;
    console.log('🔧 Bus voltage:', busVoltage);

    // courant total au bus (calculé à partir de la puissance nette absolue)
    const busCurrent = this.calculateCurrentA(Math.abs(netSkVA_total), source.connectionType, busVoltage);
    console.log('🔧 Bus current:', busCurrent);

    // calcul indépendant pour chaque départ (voisin direct de la source)
    const sourceAdj = adj.get(source.id) || [];
    console.log('🔧 Source adjacency:', sourceAdj.length, 'edges');
    const circuits: VirtualBusbar['circuits'] = [];

    // fonction utilitaire pour récupérer les nœuds d'un sous-arbre (depuis root)
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

    for (const edge of sourceAdj) {
      const departNeighbor = edge.neighborId;
      // puissance aval (charges - prod) pour le sous-arbre => convertir en injection = - (charges - prod)
      const subtree_load_minus_prod = S_aval.get(departNeighbor) || 0;
      const subtree_injection_kVA = - subtree_load_minus_prod; // positif si injection

      // courant sur le départ (A) basé sur la puissance dudit départ et la tension du bus
      const departCurrent_A = this.calculateCurrentA(Math.abs(subtree_injection_kVA), source.connectionType, busVoltage);

      // attribution proportionnelle de la ΔU transfo sur ce départ (si netSkVA_total != 0)
      const voltageShare = (netSkVA_total !== 0) ? (voltageShift_total * (subtree_injection_kVA / netSkVA_total)) : 0;

      // tension disponible au départ = tension du bus
      const U_depart_V = busVoltage;

      // analyser les nœuds du sous-arbre pour obtenir tension min/max
      const subtreeNodes = collectSubtreeNodes(departNeighbor);
      let minNodeVoltage = Number.POSITIVE_INFINITY;
      let maxNodeVoltage = Number.NEGATIVE_INFINITY;

      for (const nid of subtreeNodes) {
        const cumV = deltaUcum_V.get(nid) || 0; // cumul depuis la source
        const nodeVoltage = busVoltage - cumV; // appliquer le cumul (signe inclus)
        if (nodeVoltage < minNodeVoltage) minNodeVoltage = nodeVoltage;
        if (nodeVoltage > maxNodeVoltage) maxNodeVoltage = nodeVoltage;
      }

      if (subtreeNodes.length === 0 || minNodeVoltage === Number.POSITIVE_INFINITY) {
        // sécurité: si pas de nœuds (rare), considérer le noeud voisin lui-même
        const cumV = deltaUcum_V.get(departNeighbor) || 0;
        const nodeVoltage = busVoltage - cumV;
        minNodeVoltage = nodeVoltage;
        maxNodeVoltage = nodeVoltage;
      }

      circuits.push({
        cableId: edge.cableId,
        totalInjection_kVA: subtree_injection_kVA, // signé (pos: injection, neg: charge)
        current_A: departCurrent_A,
        voltageRise_V: voltageShare, // fraction de ΔU du transfo imputée au départ
        U_depart_V,
        minNodeVoltage_V: minNodeVoltage,
        maxNodeVoltage_V: maxNodeVoltage,
        nodesCount: subtreeNodes.length
      });
    }

    return {
      voltage_V: busVoltage,
      current_A: busCurrent,
      totalInjection_kVA: netSkVA_total,
      voltageRise_V: voltageShift_total,
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
    transformerConfig?: TransformerConfig
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

    // ---- VIRTUAL BUSBAR : calcul détaillé PAR DÉPART ----
    let virtualBusbar: VirtualBusbar | undefined;
    if (transformerConfig) {
      console.log('🔄 Calculating virtual busbar with transformer:', transformerConfig.rating);
      
      // Puissance nette signée (productions - charges)
      const netSkVA_total = totalProductions - totalLoads;

      virtualBusbar = this.calculateVirtualBusbar(
        transformerConfig, 
        netSkVA_total, 
        source, 
        adj, 
        S_aval, 
        children, 
        deltaUcum_V
      );
      
      console.log('✅ Virtual busbar calculated (per-depart):', virtualBusbar);
    }

    console.log('🔄 Creating result object...');
    const result: CalculationResult = {
      scenario,
      cables: calculatedCables,
      totalLoads_kVA: totalLoads,
      totalProductions_kVA: totalProductions,
      globalLosses_kW: Number(globalLosses.toFixed(6)),
      maxVoltageDropPercent: Number(worstAbsPct.toFixed(6)),
      compliance,
      nodeVoltageDrops,
      virtualBusbar
    };

    console.log('✅ calculateScenario completed successfully for scenario:', scenario);
    return result;
  }
}
