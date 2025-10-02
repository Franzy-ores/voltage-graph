import { Node, Cable, Project, CalculationResult, CalculationScenario, ConnectionType, CableType, TransformerConfig, VirtualBusbar, LoadModel } from '@/types/network';
import { getConnectedNodes } from '@/utils/networkConnectivity';
import { Complex, C, add, sub, mul, div, conj, scale, abs, fromPolar } from '@/utils/complex';
import { getNodeConnectionType } from '@/utils/nodeConnectionType';

export class ElectricalCalculator {
  private cosPhi: number;

  // Constantes pour la robustesse et maintenabilité
  private static readonly CONVERGENCE_TOLERANCE = 1e-4;
  private static readonly MAX_ITERATIONS = 100;
  private static readonly VOLTAGE_400V_THRESHOLD = 350;
  private static readonly MIN_VOLTAGE_SAFETY = 1e-6;
  private static readonly SMALL_IMPEDANCE_SAFETY = 1e-12;

  constructor(cosPhi: number = 0.95) {
    this.validateCosPhi(cosPhi);
    this.cosPhi = cosPhi;
  }

  private validateCosPhi(cosPhi: number): void {
    if (!isFinite(cosPhi) || cosPhi < 0 || cosPhi > 1) {
      throw new Error(`cosPhi doit être entre 0 et 1, reçu: ${cosPhi}`);
    }
  }

  setCosPhi(value: number) {
    this.validateCosPhi(value);
    this.cosPhi = value;
  }

  /**
   * Calcule la tension de source BT réelle basée sur la tension HT mesurée
   * et le rapport de transformation du transformateur
   * 
   * Formule: V_BT_réelle = V_HT_mesurée × (V_BT_nominale / V_HT_nominale)
   * 
   * @param transformerConfig Configuration du transformateur
   * @param htMeasuredVoltage Tension HT mesurée (V)
   * @param htNominalVoltage Tension HT nominale (V)
   * @param btNominalVoltage Tension BT nominale (V)
   * @returns Tension de source BT réelle (V)
   */
  calculateSourceVoltage(
    transformerConfig: TransformerConfig,
    htMeasuredVoltage: number,
    htNominalVoltage: number,
    btNominalVoltage: number
  ): number {
    // Validation des paramètres
    if (!isFinite(htMeasuredVoltage) || htMeasuredVoltage <= 0) {
      console.warn(`⚠️ Tension HT mesurée invalide: ${htMeasuredVoltage}V, utilisation tension nominale BT`);
      return transformerConfig.nominalVoltage_V;
    }
    
    if (!isFinite(htNominalVoltage) || htNominalVoltage <= 0) {
      console.warn(`⚠️ Tension HT nominale invalide: ${htNominalVoltage}V, utilisation tension nominale BT`);
      return transformerConfig.nominalVoltage_V;
    }
    
    if (!isFinite(btNominalVoltage) || btNominalVoltage <= 0) {
      console.warn(`⚠️ Tension BT nominale invalide: ${btNominalVoltage}V, utilisation configuration transformateur`);
      return transformerConfig.nominalVoltage_V;
    }
    
    // Calcul du rapport de transformation
    const transformationRatio = btNominalVoltage / htNominalVoltage;
    const realSourceVoltage = htMeasuredVoltage * transformationRatio;
    
    console.log(`📊 Calcul tension source réaliste:`);
    console.log(`   - Tension HT mesurée: ${htMeasuredVoltage.toFixed(1)}V`);
    console.log(`   - Tension HT nominale: ${htNominalVoltage.toFixed(1)}V`);
    console.log(`   - Tension BT nominale: ${btNominalVoltage.toFixed(1)}V`);
    console.log(`   - Rapport transformation: ${transformationRatio.toFixed(6)}`);
    console.log(`   - Tension source BT réelle: ${realSourceVoltage.toFixed(1)}V`);
    
    return realSourceVoltage;
  }

  /**
   * Détermine la tension de référence à utiliser pour les calculs
   * Priorité: tensionCible > calcul HT réaliste > tension nominale transformateur > tension base
   * 
   * @param source Nœud source
   * @param transformerConfig Configuration du transformateur
   * @param project Configuration du projet (pour config HT)
   * @param baseVoltage Tension de base par défaut
   * @returns Tension de référence (V)
   */
  private determineReferenceVoltage(
    source: Node,
    transformerConfig: TransformerConfig,
    project: Project,
    baseVoltage: number
  ): number {
    // 1. Priorité absolue: tension cible définie explicitement
    if (source.tensionCible) {
      console.log(`🎯 Utilisation tension cible explicite: ${source.tensionCible}V`);
      return source.tensionCible;
    }

    // 2. Si configuration HT disponible, calcul réaliste
    if (project.htVoltageConfig) {
      const {
        nominalVoltageHT_V,
        nominalVoltageBT_V,
        measuredVoltageHT_V
      } = project.htVoltageConfig;

      const realisticVoltage = this.calculateSourceVoltage(
        transformerConfig,
        measuredVoltageHT_V,
        nominalVoltageHT_V,
        nominalVoltageBT_V
      );
      
      console.log(`🔌 Utilisation tension HT réaliste: ${realisticVoltage.toFixed(1)}V`);
      return realisticVoltage;
    }

    // 3. Tension nominale du transformateur
    if (transformerConfig?.nominalVoltage_V) {
      console.log(`⚡ Utilisation tension nominale transformateur: ${transformerConfig.nominalVoltage_V}V`);
      return transformerConfig.nominalVoltage_V;
    }

    // 4. Tension de base par défaut
    console.log(`📋 Utilisation tension de base: ${baseVoltage}V`);
    return baseVoltage;
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
        return { U: 230, isThreePhase: false, useR0: true }; // Phase-neutre = 230V
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

  // Conversion phase -> "tension affichée" selon le type de connexion
  // - TRI_230V_3F : tensions composées déjà à 230V (pas de facteur supplémentaire)
  // - TÉTRA_3P+N_230_400V : tensions composées à 400V, simples à 230V
  // - MONO_230V_PP: tension entre phases (mesure directe, pas de facteur)
  // - MONO_230V_PN: tension phase-neutre (mesure directe, pas de facteur)
  private getDisplayLineScale(connectionType: ConnectionType): number {
    switch (connectionType) {
      case 'TRI_230V_3F':
        return 1; // Pas de conversion, 230V direct entre phases
      case 'TÉTRA_3P+N_230_400V':
        return Math.sqrt(3); // Conversion phase → ligne pour 400V
      case 'MONO_230V_PP':
        return 1; // Tension entre phases (230V direct)
      case 'MONO_230V_PN':
        return 1; // Tension phase-neutre (230V direct)
      default:
        return 1;
    }
  }

  /**
   * Sélection des impédances R/X selon le type de réseau et le mode de calcul
   * @param cableType Type de câble
   * @param is400V true si réseau 400V étoile, false si 230V triangle
   * @param isUnbalanced true si calcul monophasé déséquilibré
   * @param forNeutral true si sélection pour conducteur neutre
   */
  private selectRX(
    cableType: CableType, 
    is400V: boolean, 
    isUnbalanced: boolean,
    forNeutral: boolean = false
  ): { R: number, X: number } {
    // Réseau 230V triangle → toujours R12/X12 (pas de neutre)
    if (!is400V) {
      return { R: cableType.R12_ohm_per_km, X: cableType.X12_ohm_per_km };
    }
    
    // Conducteur neutre → toujours R0/X0
    if (forNeutral) {
      return { R: cableType.R0_ohm_per_km, X: cableType.X0_ohm_per_km };
    }
    
    // Réseau 400V étoile : toujours R12/X12 pour les phases
    // (R0/X0 utilisé séparément pour le neutre si nécessaire)
    return { R: cableType.R12_ohm_per_km, X: cableType.X12_ohm_per_km };
  }

  /**
   * Calcule le courant RMS par phase (A) à partir de la puissance apparente S_kVA.
   * ===== CONVENTIONS √3 HARMONISÉES =====
   * Principe: toutes les tensions internes sont en phase-neutre (230V).
   * La conversion √3 est appliquée UNIQUEMENT pour :
   * - Les charges triphasées ligne-ligne lors du calcul du courant
   * - L'affichage des tensions ligne-ligne
   * 
   * Formules:
   * - Monophasé phase-neutre: I = S / U_phase
   * - Triphasé équilibré ligne-ligne: I = S / (√3 · U_ligne)
   * 
   * S_kVA est la puissance apparente totale (kVA), positive en consommation, négative en injection.
   * sourceVoltage, s'il est fourni, est interprété comme U_line (tri) ou U_phase (mono).
   */
  private calculateCurrentA(S_kVA: number, connectionType: ConnectionType, sourceVoltage?: number): number {
    let { U_base, isThreePhase } = this.getVoltage(connectionType);

    if (sourceVoltage) {
      U_base = sourceVoltage;
    }

    const Sabs_kVA = Math.abs(S_kVA);
    
    // ===== CONVENTION UNIFIÉE : √3 appliqué SEULEMENT pour triphasé ligne-ligne =====
    let denom: number;
    if (connectionType === 'MONO_230V_PN') {
      // Monophasé phase-neutre: I = S / U_phase
      denom = U_base;
    } else if (connectionType === 'MONO_230V_PP') {
      // Monophasé phase-phase: I = S / U_phase-phase
      denom = U_base;
    } else if (connectionType === 'TRI_230V_3F') {
      // Triangle 230V : I = S / (√3 × 230V)
      denom = Math.sqrt(3) * U_base;
    } else if (connectionType === 'TÉTRA_3P+N_230_400V') {
      // Étoile 400V : I = S / (√3 × 400V)
      denom = Math.sqrt(3) * U_base;
    } else {
      // Fallback générique
      denom = isThreePhase ? (Math.sqrt(3) * U_base) : U_base;
    }
    
    if (!isFinite(denom) || denom <= 0) {
      console.warn(`⚠️ Dénominateur invalide pour le calcul du courant: ${denom}, connectionType: ${connectionType}`);
      return 0;
    }
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
        const scaleLine = this.getDisplayLineScale(nodeConnType);
        const U_node_line = abs(nV) * scaleLine;
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

  /**
   * Version étendue de calculateScenario avec support de la configuration HT
   * @param project Projet contenant la configuration HT
   * @param scenario Scénario de calcul
   * @param foisonnementCharges Foisonnement des charges
   * @param foisonnementProductions Foisonnement des productions
   * @param manualPhaseDistribution Distribution manuelle des phases (optionnel)
   */
  calculateScenarioWithHTConfig(
    project: Project,
    scenario: CalculationScenario,
    foisonnementCharges: number = 100,
    foisonnementProductions: number = 100,
    manualPhaseDistribution?: { charges: {A:number;B:number;C:number}; productions: {A:number;B:number;C:number} }
  ): CalculationResult {
    // Si configuration HT disponible, ajuster la tension de la source
    let modifiedNodes = [...project.nodes];
    
    if (project.htVoltageConfig && project.transformerConfig) {
      const {
        nominalVoltageHT_V,
        nominalVoltageBT_V,
        measuredVoltageHT_V
      } = project.htVoltageConfig;

      const sourceNode = modifiedNodes.find(n => n.isSource);
      if (sourceNode && !sourceNode.tensionCible) {
        // Calculer la tension source réaliste
        const realisticVoltage = this.calculateSourceVoltage(
          project.transformerConfig,
          measuredVoltageHT_V,
          nominalVoltageHT_V,
          nominalVoltageBT_V
        );

        // Créer une copie du nœud source avec la tension calculée
        const modifiedSourceNode = {
          ...sourceNode,
          tensionCible: realisticVoltage
        };

        // Remplacer le nœud source dans la liste
        modifiedNodes = modifiedNodes.map(n => 
          n.id === sourceNode.id ? modifiedSourceNode : n
        );

        console.log(`🔌 Application tension source HT réaliste: ${realisticVoltage.toFixed(1)}V`);
      }
    }

      // Appeler la méthode standard avec les nœuds modifiés
    return this.calculateScenario(
      modifiedNodes,
      project.cables,
      project.cableTypes,
      scenario,
      foisonnementCharges,
      foisonnementProductions,
      project.transformerConfig,
      project.loadModel ?? 'polyphase_equilibre',
      project.desequilibrePourcent ?? 0,
      manualPhaseDistribution
    );
  }
  calculateScenario(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario,
    foisonnementCharges: number = 100,
    foisonnementProductions: number = 100,
    transformerConfig?: TransformerConfig,
    loadModel: LoadModel = 'polyphase_equilibre',
    desequilibrePourcent: number = 0,
    manualPhaseDistribution?: { charges: {A:number;B:number;C:number}; productions: {A:number;B:number;C:number} }
  ): CalculationResult {
    // Validation robuste des entrées
    this.validateInputs(nodes, cables, cableTypes, foisonnementCharges, foisonnementProductions, desequilibrePourcent);
    
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

    // ---- Détection des équipements SRG2 actifs et mode déséquilibré ----
    const hasSRG2Active = nodes.some(n => n.hasSRG2Device === true);
    const isUnbalanced = loadModel === 'monophase_reparti' || hasSRG2Active;
    
    console.log(`🔍 Mode calculation decision: loadModel=${loadModel}, hasSRG2Active=${hasSRG2Active}, isUnbalanced=${isUnbalanced}`);
    if (hasSRG2Active) {
      console.log('🎯 SRG2 devices detected - forcing per-phase calculation for proper voltage regulation');
    }

    // Per-cable per-phase impedance (Ω) - construit après U_line_base et isUnbalanced
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

      // Déterminer le type de réseau et le mode
      const is400V = U_line_base >= ElectricalCalculator.VOLTAGE_400V_THRESHOLD;
      const { R: R_ohm_per_km, X: X_ohm_per_km } = this.selectRX(ct, is400V, isUnbalanced, false);
      // Series impedance per phase for the full segment
      const Z = C(R_ohm_per_km * L_km, X_ohm_per_km * L_km);
      cableZ_phase.set(cab.id, Z);
      cableChildId.set(cab.id, childId);
      cableParentId.set(cab.id, parentId);
    }

    // ===== CONVENTION UNIFIÉE : Toutes les tensions internes sont phase-neutre (230V) =====
    // La conversion √3 est appliquée UNIQUEMENT à l'entrée (si tension ligne fournie)
    // et à la sortie (affichage des tensions ligne-ligne)
    let Vslack_phase: number;
    
    // 1. Priorité absolue : tensionCible explicite
    if (source.tensionCible) {
      // Détecter si la tension fournie est ligne-ligne ou phase-neutre
      if (source.connectionType === 'TÉTRA_3P+N_230_400V' && source.tensionCible >= ElectricalCalculator.VOLTAGE_400V_THRESHOLD) {
        // Source triphasée 400V avec tension ligne fournie → convertir en phase
        Vslack_phase = source.tensionCible / Math.sqrt(3);
        console.log(`📐 Conversion √3: ${source.tensionCible}V ligne → ${Vslack_phase.toFixed(1)}V phase`);
      } else if (source.connectionType === 'TRI_230V_3F' && source.tensionCible <= 250) {
        // Triangle 230V : tension fournie est ligne-ligne, convertir en phase
        Vslack_phase = source.tensionCible / Math.sqrt(3);
        console.log(`📐 Conversion √3 (triangle): ${source.tensionCible}V ligne → ${Vslack_phase.toFixed(1)}V phase`);
      } else {
        // Autres cas : tension fournie est déjà en phase
        Vslack_phase = source.tensionCible;
      }
    }
    // 2. Sinon : utiliser tension nominale du transformateur ou base
    else if (transformerConfig?.nominalVoltage_V) {
      const U_line = transformerConfig.nominalVoltage_V;
      Vslack_phase = U_line >= ElectricalCalculator.VOLTAGE_400V_THRESHOLD ? U_line / Math.sqrt(3) : U_line;
    }
    else {
      Vslack_phase = U_line_base >= ElectricalCalculator.VOLTAGE_400V_THRESHOLD ? U_line_base / Math.sqrt(3) : U_line_base;
    }
    
    // 3. Validation (safety)
    if (!isFinite(Vslack_phase) || Vslack_phase < 200 || Vslack_phase > 450) {
      console.warn(`⚠️ Vslack_phase hors limites: ${Vslack_phase}V, réinitialisation à 230V`);
      Vslack_phase = 230;
    }
    
    console.log(`✅ Vslack_phase initialisé: ${Vslack_phase.toFixed(1)}V (source: ${source.tensionCible ? 'tensionCible' : 'nominal'})`);
    const Vslack = C(Vslack_phase, 0);

    // Transformer series impedance (per phase)
    let Ztr_phase: Complex | null = null;
    if (transformerConfig) {
      // Ztr (Ω/phase) à partir de Ucc% (en p.u.) et du ratio X/R si fourni
      const Zpu = transformerConfig.shortCircuitVoltage_percent / 100;
      const Sbase_VA = transformerConfig.nominalPower_kVA * 1000;
      // Zbase (Ω) par phase selon standard IEEE : Zbase = U_line² / Sbase
      const Zbase = (U_line_base * U_line_base) / Sbase_VA; // Ω
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

    // ---- Power Flow using Backward-Forward Sweep (complex R+jX) ----
    
    if (hasSRG2Active) {
      console.log('🎯 SRG2 devices detected - forcing per-phase calculation for proper voltage regulation');
      const srg2Nodes = nodes.filter(n => n.hasSRG2Device).map(n => ({
        id: n.id, 
        coefficients: n.srg2RegulationCoefficients 
      }));
      console.log('🎯 SRG2 nodes:', srg2Nodes);
    }

    if (isUnbalanced) {
      // Répartition S_total -> S_A/S_B/S_C selon la répartition manuelle ou équilibré par défaut
      const globalAngle = 0; // Angle identique pour tous les circuits pour préserver la notion de circuit
      
      // Utiliser la répartition manuelle si disponible, sinon répartition équitable par défaut
      let pA_charges = 1/3, pB_charges = 1/3, pC_charges = 1/3;
      let pA_productions = 1/3, pB_productions = 1/3, pC_productions = 1/3;
      
      if (manualPhaseDistribution) {
        pA_charges = manualPhaseDistribution.charges.A / 100;
        pB_charges = manualPhaseDistribution.charges.B / 100;
        pC_charges = manualPhaseDistribution.charges.C / 100;
        pA_productions = manualPhaseDistribution.productions.A / 100;
        pB_productions = manualPhaseDistribution.productions.B / 100;
        pC_productions = manualPhaseDistribution.productions.C / 100;
      }
      
      // Vérification de cohérence
      const totalCharges = pA_charges + pB_charges + pC_charges;
      const totalProductions = pA_productions + pB_productions + pC_productions;
      if (Math.abs(totalCharges - 1) > 1e-6) {
        console.warn(`⚠️ Répartition des charges incohérente: pA=${pA_charges}, pB=${pB_charges}, pC=${pC_charges}, total=${totalCharges}`);
      }
      if (Math.abs(totalProductions - 1) > 1e-6) {
        console.warn(`⚠️ Répartition des productions incohérente: pA=${pA_productions}, pB=${pB_productions}, pC=${pC_productions}, total=${totalProductions}`);
      }

      const S_A_map = new Map<string, Complex>();
      const S_B_map = new Map<string, Complex>();
      const S_C_map = new Map<string, Complex>();

      for (const n of nodes) {
        const S_kVA_tot = S_node_total_kVA.get(n.id) || 0; // signé
        const sign = Math.sign(S_kVA_tot) || 1;
        
        // Séparer charges et productions pour appliquer des répartitions différentes
        let S_A_kVA = 0, S_B_kVA = 0, S_C_kVA = 0;
        
        if (S_kVA_tot > 0) {
          // Charges positives - utiliser la répartition des charges
          S_A_kVA = S_kVA_tot * pA_charges;
          S_B_kVA = S_kVA_tot * pB_charges;
          S_C_kVA = S_kVA_tot * pC_charges;
        } else {
          // Productions négatives - utiliser la répartition des productions
          S_A_kVA = S_kVA_tot * pA_productions;
          S_B_kVA = S_kVA_tot * pB_productions;
          S_C_kVA = S_kVA_tot * pC_productions;
        }
        
        const P_A_kW = S_A_kVA * cosPhi_eff;
        const Q_A_kVAr = Math.abs(S_A_kVA) * sinPhi * sign;
        const P_B_kW = S_B_kVA * cosPhi_eff;
        const Q_B_kVAr = Math.abs(S_B_kVA) * sinPhi * sign;
        const P_C_kW = S_C_kVA * cosPhi_eff;
        const Q_C_kVAr = Math.abs(S_C_kVA) * sinPhi * sign;
        S_A_map.set(n.id, C(P_A_kW * 1000, Q_A_kVAr * 1000));
        S_B_map.set(n.id, C(P_B_kW * 1000, Q_B_kVAr * 1000));
        S_C_map.set(n.id, C(P_C_kW * 1000, Q_C_kVAr * 1000));

        // Intégrer les contributions explicites P/Q (équipements virtuels)
        const addExtra = (items: any[], sign: 1 | -1) => {
          for (const it of items || []) {
            const P = Number((it as any).P_kW) || 0;
            const Q = Number((it as any).Q_kVAr) || 0;
            if (P === 0 && Q === 0) continue;
            const phase = (it as any).phase as 'A' | 'B' | 'C' | undefined;
            const Sextra = C(P * 1000 * sign, Q * 1000 * sign);
            if (phase === 'A') {
              S_A_map.set(n.id, add(S_A_map.get(n.id) || C(0,0), Sextra));
            } else if (phase === 'B') {
              S_B_map.set(n.id, add(S_B_map.get(n.id) || C(0,0), Sextra));
            } else if (phase === 'C') {
              S_C_map.set(n.id, add(S_C_map.get(n.id) || C(0,0), Sextra));
            } else {
              const third = scale(Sextra, 1/3);
              S_A_map.set(n.id, add(S_A_map.get(n.id) || C(0,0), third));
              S_B_map.set(n.id, add(S_B_map.get(n.id) || C(0,0), third));
              S_C_map.set(n.id, add(S_C_map.get(n.id) || C(0,0), third));
            }
          }
        };
        addExtra((n as any).clients || [], 1);
        addExtra((n as any).productions || [], -1);
      }

      const runBFSForPhase = (angleDeg: number, S_map: Map<string, Complex>, phaseLabel: 'A'|'B'|'C') => {
        const V_node_phase = new Map<string, Complex>();
        const I_branch_phase = new Map<string, Complex>();
        const I_inj_node_phase = new Map<string, Complex>();

        const Vslack_phase_ph = fromPolar(Vslack_phase, this.deg2rad(angleDeg));
        for (const n of nodes) V_node_phase.set(n.id, Vslack_phase_ph);

        let iter2 = 0;
        let converged2 = false;
        while (iter2 < ElectricalCalculator.MAX_ITERATIONS) {
          iter2++;
          const V_prev2 = new Map(V_node_phase);

          I_branch_phase.clear();
          I_inj_node_phase.clear();

          for (const n of nodes) {
            const Vn = V_node_phase.get(n.id) || Vslack_phase_ph;
            const Sph = S_map.get(n.id) || C(0, 0);
            const Vsafe = abs(Vn) > ElectricalCalculator.MIN_VOLTAGE_SAFETY ? Vn : Vslack_phase_ph;
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
              // Calculer tension selon Kirchhoff : V_v = V_u - Z * I_uv
              const Vv = sub(Vu, mul(Z, Iuv));
              
              // Vérifier si le nœud de destination a un dispositif SRG2
              const vNode = nodeById.get(v);
              if (vNode?.hasSRG2Device && vNode.srg2RegulationCoefficients) {
                // Appliquer les coefficients de régulation SRG2 aux tensions calculées
                let regulationCoeff = 0;
                if (angleDeg === 0) {
                  // Phase A
                  regulationCoeff = vNode.srg2RegulationCoefficients.A;
                } else if (angleDeg === -120) {
                  // Phase B
                  regulationCoeff = vNode.srg2RegulationCoefficients.B;
                } else if (angleDeg === 120) {
                  // Phase C
                  regulationCoeff = vNode.srg2RegulationCoefficients.C;
                } else {
                  // Fallback: utiliser la moyenne
                  const avgCoeff = (vNode.srg2RegulationCoefficients.A + vNode.srg2RegulationCoefficients.B + vNode.srg2RegulationCoefficients.C) / 3;
                  regulationCoeff = avgCoeff;
                }
                
                // Appliquer le coefficient: V_regulated = V_calculated × (1 + coefficient/100)
                const regulationFactor = 1 + (regulationCoeff / 100);
                const Vv_regulated = scale(Vv, regulationFactor);
                V_node_phase.set(v, Vv_regulated);
                console.log(`🎯 SRG2 régulation nœud ${v} (phase ${angleDeg}°): coeff=${regulationCoeff.toFixed(1)}%, V=${abs(Vv).toFixed(1)}V -> ${abs(Vv_regulated).toFixed(1)}V`);
              } else if (loadModel === "monophase_reparti" && vNode?.tensionCiblePhaseA && vNode?.tensionCiblePhaseB && vNode?.tensionCiblePhaseC) {
                // En mode monophasé déséquilibré, utiliser les tensions par phase
                let Vv_target: Complex;
                if (angleDeg === 0) {
                  // Phase A
                  Vv_target = C(vNode.tensionCiblePhaseA, 0);
                } else if (angleDeg === -120) {
                  // Phase B
                  Vv_target = C(vNode.tensionCiblePhaseB, 0);
                } else if (angleDeg === 120) {
                  // Phase C
                  Vv_target = C(vNode.tensionCiblePhaseC, 0);
                } else {
                  // Fallback: utiliser la moyenne
                  const avgVoltage = (vNode.tensionCiblePhaseA + vNode.tensionCiblePhaseB + vNode.tensionCiblePhaseC) / 3;
                  Vv_target = C(avgVoltage, 0);
                }
                V_node_phase.set(v, Vv_target);
                console.log(`🎯 Nœud ${v} (phase ${angleDeg}°): tension cible par phase imposée ${abs(Vv_target).toFixed(1)}V`);
              } else {
                // Calcul normal pour les nœuds non-SRG2
                const Vv = sub(Vu, mul(Z, Iuv));
                V_node_phase.set(v, Vv);
              }
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
          if (maxDelta / (Vslack_phase || 1) < ElectricalCalculator.CONVERGENCE_TOLERANCE) { converged2 = true; break; }
        }
        if (!converged2) {
          console.warn(`⚠️ BFS phase ${angleDeg}° non convergé`);
        }
        return { V_node_phase, I_branch_phase };
      };

      // Déphasages corrects pour les phases A, B, C
      const phaseA = runBFSForPhase(0, S_A_map, 'A');      // 0°
      const phaseB = runBFSForPhase(-120, S_B_map, 'B');   // -120°
      const phaseC = runBFSForPhase(120, S_C_map, 'C');    // +120°
      
      // Détection du système 400V pour le calcul du courant neutre
      const is400V = U_line_base >= ElectricalCalculator.VOLTAGE_400V_THRESHOLD;
      
      // ===== CORRECTION MAJEURE : Propagation de la chute de tension du conducteur neutre =====
      // Pour les réseaux 400V phase-neutre, le courant neutre crée une chute de tension supplémentaire
      // qui doit être ajoutée aux tensions phase-neutre calculées
      if (is400V) {
        // Calculer la tension du neutre à chaque nœud en propageant la chute Z_neutre * I_N
        const V_neutral = new Map<string, Complex>();
        V_neutral.set(source.id, C(0, 0)); // Le neutre à la source est à 0V (référence)
        
        // BFS depuis la source pour propager la tension du neutre
        const stack3 = [source.id];
        const visited3 = new Set<string>();
        
        while (stack3.length) {
          const u = stack3.pop()!;
          if (visited3.has(u)) continue;
          visited3.add(u);
          
          const Vn_parent = V_neutral.get(u) || C(0, 0);
          
          for (const v of children.get(u) || []) {
            const cab = parentCableOfChild.get(v);
            if (!cab) continue;
            
            // Calcul du courant neutre sur ce segment (somme vectorielle complexe)
            const IA = phaseA.I_branch_phase.get(cab.id) || C(0, 0);
            const IB = phaseB.I_branch_phase.get(cab.id) || C(0, 0);
            const IC = phaseC.I_branch_phase.get(cab.id) || C(0, 0);
            const IN_phasor = add(add(IA, IB), IC); // Somme vectorielle complexe
            
            // Récupérer l'impédance du conducteur neutre (R0, X0)
            const distalNode = nodeById.get(v)!;
            const ct = cableTypeById.get(cab.typeId);
            if (!ct) continue;
            const length_m = this.calculateLengthMeters(cab.coordinates || []);
            const L_km = length_m / 1000;
            
            // Utiliser R0/X0 pour le conducteur neutre (forNeutral = true)
            const is400V = U_line_base >= ElectricalCalculator.VOLTAGE_400V_THRESHOLD;
            const { R: R0, X: X0 } = this.selectRX(ct, is400V, isUnbalanced, true);
            const Z_neutral = C(R0 * L_km, X0 * L_km);
            
            // Chute de tension dans le neutre (phasor)
            const dVn = mul(Z_neutral, IN_phasor);
            
            // ✅ CORRECTION CRITIQUE : Propagation cohérente du neutre (sub au lieu de add)
            const Vn_child = sub(Vn_parent, dVn);
            V_neutral.set(v, Vn_child);
            
            stack3.push(v);
          }
        }
        
        // Corriger les tensions phase-neutre en soustrayant la tension du neutre
        // V_phase_neutre_corrigé = V_phase - V_neutral
        for (const n of nodes) {
          if (n.id === source.id) continue; // La source n'a pas besoin de correction
          
          const Vn = V_neutral.get(n.id);
          if (!Vn) continue;
          
          // Corriger les 3 phases
          const Va = phaseA.V_node_phase.get(n.id);
          const Vb = phaseB.V_node_phase.get(n.id);
          const Vc = phaseC.V_node_phase.get(n.id);
          
          if (Va) phaseA.V_node_phase.set(n.id, sub(Va, Vn));
          if (Vb) phaseB.V_node_phase.set(n.id, sub(Vb, Vn));
          if (Vc) phaseC.V_node_phase.set(n.id, sub(Vc, Vn));
        }
      }

      // Compose cable results (par phase)
      calculatedCables.length = 0;
      globalLosses = 0;

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
        // Pour TRI_230V_3F, pas de conversion car travail direct en composé
        const deltaU_line_V = distalNode.connectionType === 'TRI_230V_3F' 
          ? Math.max(dVA, dVB, dVC) // Direct en 230V composé
          : Math.max(dVA, dVB, dVC) * (isThreePhase ? Math.sqrt(3) : 1);

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
        
        // ✅ CORRECTION : Pour conformité EN50160, toujours prendre la PIRE phase (MIN pour chute de tension)
        let U_node_line_tension: number;
        const scaleLine = this.getDisplayLineScale(n.connectionType);
        U_node_line_tension = Math.min(Va_mag, Vb_mag, Vc_mag) * scaleLine;

        // ===== CORRECTION 2 BIS : RÉFÉRENCE DE TENSION POUR CONFORMITÉ =====
        let U_ref_display: number;
        if (n.connectionType === 'MONO_230V_PN') {
          // Référence phase-neutre EN50160
          U_ref_display = 230;
        } else if (sourceNode?.tensionCible) {
          U_ref_display = sourceNode.tensionCible;
        } else {
          const { U_base } = this.getVoltage(n.connectionType);
          U_ref_display = U_base;
        }

        const deltaU_V = U_ref_display - U_node_line_tension;
        const deltaU_pct = U_ref_display ? (deltaU_V / U_ref_display) * 100 : 0;

        // ===== CORRECTION 3 : CALCUL DE CONFORMITÉ EN50160 AVEC RÉFÉRENCE NOMINALE CORRECTE =====
        let U_nom: number;
        if (n.connectionType === 'MONO_230V_PN') {
          // Pour les nœuds monophasés phase-neutre : référence 230V (EN50160)
          U_nom = 230;
        } else {
          // Logique standard selon le type de connexion
          const { U_base } = this.getVoltage(n.connectionType);
          U_nom = U_base;
        }
        
        const deltaU_pct_nominal = U_nom ? ((U_nom - U_node_line_tension) / U_nom) * 100 : 0;
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

      // ===== CORRECTION MAJEURE : AFFICHAGE COHÉRENT DES TENSIONS EN MODE DÉSÉQUILIBRÉ =====
      const nodeMetricsPerPhase = nodes.map(n => {
        const Va = phaseA.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        const Vb = phaseB.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        const Vc = phaseC.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        
        // Tensions de phase (calculs internes)
        const Va_phase = abs(Va);
        const Vb_phase = abs(Vb);
        const Vc_phase = abs(Vc);
        
        // ===== CORRECTION 1 : AFFICHAGE DES TENSIONS SELON LE TYPE DE CONNEXION =====
        let Va_display, Vb_display, Vc_display, U_ref: number;
        
        if (n.connectionType === 'MONO_230V_PN') {
          // Monophasé phase-neutre : afficher tensions phase-neutre directement (PAS de √3 !)
          Va_display = Va_phase;
          Vb_display = Vb_phase; 
          Vc_display = Vc_phase;
          U_ref = 230; // Référence phase-neutre EN50160
          
        } else if (n.connectionType === 'TRI_230V_3F') {
          // Triphasé 230V : tensions composées = tensions de phase (système 230V)
          Va_display = Va_phase;
          Vb_display = Vb_phase;
          Vc_display = Vc_phase;
          U_ref = 230;
          
        } else if (n.connectionType === 'TÉTRA_3P+N_230_400V') {
          // Triphasé 400V : afficher tensions composées (√3 × phase)
          Va_display = Va_phase * Math.sqrt(3);
          Vb_display = Vb_phase * Math.sqrt(3);
          Vc_display = Vc_phase * Math.sqrt(3);
          U_ref = 400;
          
        } else {
          // Autres cas : logique avec scaling
          const scaleLine = this.getDisplayLineScale(n.connectionType);
          Va_display = Va_phase * scaleLine;
          Vb_display = Vb_phase * scaleLine;
          Vc_display = Vc_phase * scaleLine;
          
          // Référence standard
          const sourceNode = nodes.find(s => s.isSource);
          if (sourceNode?.tensionCible) {
            U_ref = sourceNode.tensionCible;
          } else {
            const { U_base } = this.getVoltage(n.connectionType);
            U_ref = U_base;
          }
        }
        
        // ===== CORRECTION 2 : CALCUL DE CONFORMITÉ EN50160 AVEC RÉFÉRENCE APPROPRIÉE =====
        
        // Calcul des chutes de tension par rapport à la référence
        const dropA = U_ref - Va_display;
        const dropB = U_ref - Vb_display;
        const dropC = U_ref - Vc_display;
        
        // ===== AMÉLIORATION : CONFORMITÉ EN50160 MULTI-PHASE =====
        // Évaluation individuelle de chaque phase selon EN50160
        const compliancePerPhase = {
          A: this.getComplianceStatus(Math.abs((U_ref - Va_display) / U_ref * 100)),
          B: this.getComplianceStatus(Math.abs((U_ref - Vb_display) / U_ref * 100)),
          C: this.getComplianceStatus(Math.abs((U_ref - Vc_display) / U_ref * 100))
        };
        
        // Conformité globale du nœud = pire cas des 3 phases
        const phaseCompliances = [compliancePerPhase.A, compliancePerPhase.B, compliancePerPhase.C];
        const nodeCompliance: 'normal' | 'warning' | 'critical' = phaseCompliances.includes('critical') ? 'critical' :
                              phaseCompliances.includes('warning') ? 'warning' : 'normal';
        
        return {
          nodeId: n.id,
          voltagesPerPhase: {
            A: Va_display,
            B: Vb_display,
            C: Vc_display
          },
          voltageDropsPerPhase: {
            A: dropA,
            B: dropB,
            C: dropC
          },
          compliancePerPhase,
          nodeCompliance
        };
      });

      // ===== AMÉLIORATION : CONFORMITÉ GLOBALE BASÉE SUR L'ANALYSE MULTI-PHASE =====
      // Évaluation de la conformité globale à partir de l'analyse par phase
      const globalComplianceFromPhases = nodeMetricsPerPhase.reduce((worst, node) => {
        if (node.nodeCompliance === 'critical') return 'critical';
        if (node.nodeCompliance === 'warning' && worst !== 'critical') return 'warning';
        return worst;
      }, 'normal' as 'normal' | 'warning' | 'critical');
      
      // Utiliser la conformité multi-phase si elle est plus restrictive que l'analyse globale
      const finalCompliance = globalComplianceFromPhases === 'critical' ? 'critical' :
                              globalComplianceFromPhases === 'warning' ? 'warning' : compliance;

      const result: CalculationResult = {
        scenario,
        cables: calculatedCables,
        totalLoads_kVA: totalLoads,
        totalProductions_kVA: totalProductions,
        globalLosses_kW: Number(globalLosses.toFixed(6)),
        maxVoltageDropPercent: Number(worstAbsPct.toFixed(6)),
        maxVoltageDropCircuitNumber: undefined,
        compliance: finalCompliance,
        nodeVoltageDrops,
        nodeMetrics: undefined,
        nodePhasors: undefined,
        nodePhasorsPerPhase,
        nodeMetricsPerPhase, // Nouvelles métriques par phase avec conformité individuelle
        cablePowerFlows: undefined,
        virtualBusbar
      };

      console.log(`[ElectricalCalculator] Conformité multi-phase: global=${globalComplianceFromPhases}, final=${finalCompliance}`);
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

        // Contributions explicites P/Q (équipements virtuels)
        let S_extra_VA = C(0, 0);
        for (const it of ((n as any).clients || [])) {
          const P = Number((it as any).P_kW) || 0;
          const Q = Number((it as any).Q_kVAr) || 0;
          if (P !== 0 || Q !== 0) {
            S_extra_VA = add(S_extra_VA, C(P * 1000, Q * 1000));
          }
        }
        for (const it of ((n as any).productions || [])) {
          const P = Number((it as any).P_kW) || 0;
          const Q = Number((it as any).Q_kVAr) || 0;
          if (P !== 0 || Q !== 0) {
            S_extra_VA = sub(S_extra_VA, C(P * 1000, Q * 1000)); // injection => signe négatif
          }
        }

        const { isThreePhase } = this.getVoltage(n.connectionType);
        const divisor = isThreePhase ? 3 : 1;
        const S_total_phase = scale(add(S_VA_total, S_extra_VA), 1 / divisor);
        S_node_phase_VA.set(n.id, S_total_phase);
      }
    };
    computeNodeS();

    // Iterative BFS
    const maxIter = ElectricalCalculator.MAX_ITERATIONS;
    const tol = ElectricalCalculator.CONVERGENCE_TOLERANCE;
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
        const Vsafe = abs(Vn) > ElectricalCalculator.MIN_VOLTAGE_SAFETY ? Vn : Vslack;
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
          
          // Vérifier si le nœud de destination est une source SRG2
          const vNode = nodeById.get(v);
          if (vNode?.tensionCible) {
            // Utiliser la tension cible globale si disponible
            const Vv_target = C(vNode.tensionCible, 0);
            V_node.set(v, Vv_target);
            console.log(`🎯 Nœud ${v}: tension cible appliquée ${vNode.tensionCible.toFixed(1)}V`);
          } else {
            // Calcul normal pour les nœuds sans tension cible
            const Vv = sub(Vu, mul(Z, Iuv));
            V_node.set(v, Vv);
          }
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
      console.warn(`⚠️ Backward–Forward Sweep non convergé (tol=${tol}, maxIter=${maxIter}). Les résultats peuvent être approximatifs.`);
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
        const is400V = U_line_base >= ElectricalCalculator.VOLTAGE_400V_THRESHOLD;
        const { R: R_ohm_per_km, X: X_ohm_per_km } = this.selectRX(ct, is400V, false, false);
        Z = C(R_ohm_per_km * L_km, X_ohm_per_km * L_km);
      }

      const Iph = I_branch.get(cab.id) || C(0, 0);
      const dVph = mul(Z!, Iph);
      const current_A = abs(Iph);
      // Pour TRI_230V_3F, pas de conversion car travail direct en composé
      const deltaU_line_V = distalNode.connectionType === 'TRI_230V_3F' 
        ? abs(dVph) // Direct en 230V composé
        : abs(dVph) * (isThreePhase ? Math.sqrt(3) : 1);

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
      const scaleLine = this.getDisplayLineScale(n.connectionType);
      const U_node_line = abs(Vn) * scaleLine;

      // Référence d'affichage: tension cible source si fournie, sinon base de ce type de connexion
      let { U_base: U_ref_display } = this.getVoltage(n.connectionType);
      if (sourceNode?.tensionCible) U_ref_display = sourceNode.tensionCible;

      const deltaU_V = U_ref_display - U_node_line;
      const deltaU_pct = U_ref_display ? (deltaU_V / U_ref_display) * 100 : 0;

      // Référence nominale (conformité): logique spéciale pour MONO_230V_PN en système 400V
      let U_nom: number;
      if (n.connectionType === 'MONO_230V_PN' && transformerConfig?.nominalVoltage_V && transformerConfig.nominalVoltage_V >= 350) {
        // Pour les nœuds monophasés phase-neutre en système 400V : référence 230V
        U_nom = 230;
      } else {
        // Logique standard
        const { U_base } = this.getVoltage(n.connectionType);
        U_nom = U_base;
      }
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
      // Pour TRI_230V_3F, pas de conversion car travail direct en composé
      const V_nom_phase = n.connectionType === 'TRI_230V_3F' 
        ? U_nom_line // 230V composée directement
        : U_nom_line / (isThreePhase ? Math.sqrt(3) : 1);
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

    // ---- Generate nodeMetricsPerPhase for balanced mode ----
    const nodeMetricsPerPhase = nodes.map(n => {
      const Vn = V_node.get(n.id) || Vslack;
      const { isThreePhase, U_base: U_nom_line } = this.getVoltage(n.connectionType);
      const V_phase_V = abs(Vn);
      
      const scaleLine = this.getDisplayLineScale(n.connectionType);
      const V_display = V_phase_V * scaleLine;
      
      let { U_base: U_ref } = this.getVoltage(n.connectionType);
      const sourceNode = nodes.find(s => s.isSource);
      if (sourceNode?.tensionCible) U_ref = sourceNode.tensionCible;
      
      console.log(`🔍 Balanced mode - Node ${n.id}: ${V_display.toFixed(1)}V (same for all phases)`);
      
      return {
        nodeId: n.id,
        voltagesPerPhase: {
          A: V_display,
          B: V_display, 
          C: V_display
        },
        voltageDropsPerPhase: {
          A: U_ref - V_display,
          B: U_ref - V_display,
          C: U_ref - V_display
        }
      };
    });

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
      nodePhasorsPerPhase: undefined, // Seulement en mode déséquilibré
      nodeMetricsPerPhase, // Maintenant toujours disponible
      cablePowerFlows,
      virtualBusbar,
      manualPhaseDistribution
    };

    console.log('✅ calculateScenario completed successfully for scenario:', scenario);
    return result;
  }

  // Méthodes utilitaires pour validation et gestion d'erreurs
  private validateInputs(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    foisonnementCharges: number,
    foisonnementProductions: number,
    desequilibrePourcent: number
  ): void {
    if (!nodes || nodes.length === 0) {
      throw new Error('Aucun nœud fourni pour le calcul');
    }
    
    if (!cables || cables.length === 0) {
      throw new Error('Aucun câble fourni pour le calcul');
    }
    
    if (!cableTypes || cableTypes.length === 0) {
      throw new Error('Aucun type de câble fourni pour le calcul');
    }
    
    if (!isFinite(foisonnementCharges) || foisonnementCharges < 0 || foisonnementCharges > 200) {
      throw new Error(`Facteur de foisonnement charges invalide: ${foisonnementCharges}% (doit être entre 0 et 200)`);
    }
    
    if (!isFinite(foisonnementProductions) || foisonnementProductions < 0 || foisonnementProductions > 200) {
      throw new Error(`Facteur de foisonnement productions invalide: ${foisonnementProductions}% (doit être entre 0 et 200)`);
    }
    
    if (!isFinite(desequilibrePourcent) || desequilibrePourcent < 0 || desequilibrePourcent > 100) {
      throw new Error(`Pourcentage de déséquilibre invalide: ${desequilibrePourcent}% (doit être entre 0 et 100)`);
    }

    // Vérifier qu'il y a exactement une source
    const sources = nodes.filter(n => n.isSource);
    if (sources.length !== 1) {
      throw new Error(`Le réseau doit avoir exactement une source, trouvé: ${sources.length}`);
    }

    // Vérifier que tous les types de câbles référencés existent
    const cableTypeIds = new Set(cableTypes.map(ct => ct.id));
    const missingTypes = cables
      .map(c => c.typeId)
      .filter(typeId => !cableTypeIds.has(typeId));
    
    if (missingTypes.length > 0) {
      throw new Error(`Types de câbles manquants: ${missingTypes.join(', ')}`);
    }

    // Vérifier que tous les nœuds référencés dans les câbles existent
    const nodeIds = new Set(nodes.map(n => n.id));
    const missingNodes: string[] = [];
    
    for (const cable of cables) {
      if (!nodeIds.has(cable.nodeAId)) missingNodes.push(cable.nodeAId);
      if (!nodeIds.has(cable.nodeBId)) missingNodes.push(cable.nodeBId);
    }
    
    if (missingNodes.length > 0) {
      throw new Error(`Nœuds manquants référencés dans les câbles: ${[...new Set(missingNodes)].join(', ')}`);
    }
  }
}
