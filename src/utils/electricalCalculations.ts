import { Complex, C, add, sub, mul, scale, abs } from "./complex";

import { 
  Node, Cable, CableType, Project, CalculationResult, ClientCharge, ProductionPV, 
  TransformerConfig, VoltageSystem, ConnectionType, LoadModel, CalculationScenario 
} from '../types/network';

export class ElectricalCalculator {
  // Constantes de calcul
  public static readonly CONVERGENCE_TOLERANCE = 1e-6;
  public static readonly MAX_ITERATIONS = 100;
  public static readonly MIN_VOLTAGE_TOLERANCE = 0.95;
  public static readonly MAX_VOLTAGE_TOLERANCE = 1.05;
  public static readonly MAX_CURRENT_DENSITY = 8; // A/mm²
  public static readonly NOMINAL_FREQUENCY = 50; // Hz

  protected cosPhi: number;

  constructor(cosPhi: number = 0.9) {
    this.cosPhi = Math.max(0.1, Math.min(1.0, cosPhi));
  }

  /**
   * Méthode statique pour calculer la longueur d'un câble à partir de ses coordonnées
   */
  static calculateCableLength(coordinates: { lat: number; lng: number }[]): number {
    if (!coordinates || coordinates.length < 2) return 0;
    
    let totalLength = 0;
    for (let i = 1; i < coordinates.length; i++) {
      const prev = coordinates[i - 1];
      const curr = coordinates[i];
      
      // Distance approximative en mètres (formule simplifiée pour petites distances)
      const R = 6371000; // Rayon de la Terre en mètres
      const dLat = ((curr.lat - prev.lat) * Math.PI) / 180;
      const dLng = ((curr.lng - prev.lng) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos((prev.lat * Math.PI) / 180) * Math.cos((curr.lat * Math.PI) / 180) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;
      
      totalLength += distance;
    }
    
    return totalLength;
  }

  /**
   * Calcule un scénario avec configuration HT
   */
  calculateScenarioWithHTConfig(
    project: Project,
    scenario: CalculationScenario,
    foisonnementCharges: number = 100,
    foisonnementProductions: number = 100,
    manualPhaseDistribution?: any
  ): CalculationResult {
    
    console.log(`🔍 Début calculateScenarioWithHTConfig pour le scénario: ${scenario}`);
    console.log(`📊 Paramètres: foisonnement charges=${foisonnementCharges}%, productions=${foisonnementProductions}%`);
    console.log(`⚡ Modèle de charge: ${project.loadModel}, Système de tension: ${project.voltageSystem}`);

    // Validation des entrées
    this.validateInputs(project.nodes, project.cables, project.cableTypes, foisonnementCharges, foisonnementProductions, 0);

    // ---- Détection des équipements SRG2 actifs ----
    const hasSRG2Active = project.nodes.some(n => n.hasSRG2Device === true);
    
    // ---- Mode déséquilibré (monophasé réparti) OU SRG2 actif -> calcul triphasé par phase ----
    const isUnbalanced = project.loadModel === 'monophase_reparti' || hasSRG2Active;
    
    console.log(`🔍 Mode calculation decision: loadModel=${project.loadModel}, hasSRG2Active=${hasSRG2Active}, isUnbalanced=${isUnbalanced}`);
    
    if (hasSRG2Active) {
      console.log('🎯 SRG2 devices detected - forcing per-phase calculation for voltage transformation');
      const srg2Nodes = project.nodes.filter(n => n.hasSRG2Device).map(n => ({ 
        id: n.id, 
        coefficients: n.srg2VoltageCoefficients 
      }));
      console.log('🎯 SRG2 nodes with coefficients:', srg2Nodes);
    }

    // Copie des données pour éviter les mutations
    const workingNodes = project.nodes.map(n => ({ ...n }));
    const workingCables = project.cables.map(c => ({ ...c }));

    // Préparation des données selon le scénario
    const { processedNodes, processedCables } = this.prepareScenarioData(
      workingNodes, 
      workingCables, 
      scenario, 
      foisonnementCharges, 
      foisonnementProductions, 
      0
    );

    let result: CalculationResult;

    if (isUnbalanced) {
      // Calcul triphasé déséquilibré (par phase)
      result = this.calculateUnbalancedThreePhase(
        processedNodes,
        processedCables,
        project.cableTypes,
        project.voltageSystem,
        project.loadModel
      );
    } else {
      // Calcul monophasé équilibré classique
      result = this.calculateSinglePhase(
        processedNodes,
        processedCables,
        project.cableTypes,
        project.voltageSystem
      );
    }

    // Calcul du bilan énergétique global
    const { 
      totalPowerLosses,
      totalApparentPower,
      totalActivePower,
      totalReactivePower,
      averageVoltage,
      minVoltage,
      maxVoltage,
      voltageCompliance,
      currentCompliance
    } = this.calculateGlobalMetrics(result, project.voltageSystem);

    // Calcul du bus virtuel
    const virtualBusbar = this.calculateVirtualBusbar(processedNodes, scenario, project.voltageSystem);

    // Construire le résultat final
    const finalResult: CalculationResult = {
      ...result,
      scenario,
      virtualBusbar
    };

    console.log('✅ calculateScenarioWithHTConfig completed successfully for scenario:', scenario);
    return finalResult;
  }

  /**
   * Calcul triphasé déséquilibré (par phase)
   */
  private calculateUnbalancedThreePhase(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    voltageSystem: VoltageSystem,
    loadModel: LoadModel
  ): CalculationResult {
    
    console.log('🔄 Début du calcul triphasé déséquilibré par phase');
    
    // Constantes selon le système de tension
    const isVoltageSystem400V = voltageSystem === 'TÉTRA_3P+N_230_400V';
    const Vnom = isVoltageSystem400V ? 230 : 400; // Tension nominale par phase
    const VnomLL = isVoltageSystem400V ? 400 : 400; // Tension composée nominale
    
    console.log(`⚡ Tensions nominales: phase=${Vnom}V, composée=${VnomLL}V`);

    // Créer les maps des types de câbles et des nœuds
    const cableTypeMap = new Map(cableTypes.map(ct => [ct.id, ct]));
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const cableById = new Map(cables.map(c => [c.id, c]));

    // Trouver la source principale (transformateur)
    const source = nodes.find(n => n.isSource);
    if (!source) {
      throw new Error('Aucune source trouvée dans le réseau');
    }

    // Construire la topologie du réseau
    const { children, parent, parentCableOfChild } = this.buildNetworkTopology(nodes, cables);

    // Calcul triphasé: phases A, B, C (0°, -120°, +120°)
    const phases = [
      { name: 'A', angle: 0 },
      { name: 'B', angle: -120 },  
      { name: 'C', angle: 120 }
    ];

    // Résultats par phase
    const nodeVoltagesPerPhase = new Map<string, {A: Complex, B: Complex, C: Complex}>();
    const cableCurrentsPerPhase = new Map<string, {A: Complex, B: Complex, C: Complex}>();
    const cablePowersPerPhase = new Map<string, {A: Complex, B: Complex, C: Complex}>();

    // Calcul pour chaque phase séparément
    for (const phase of phases) {
      console.log(`🔍 Calcul phase ${phase.name} (${phase.angle}°)`);
      
      const result = this.calculateSinglePhaseWithAngle(
        nodes, cables, cableTypes, source, children, parent, parentCableOfChild,
        nodeById, cableById, cableTypeMap, phase.angle, Vnom, loadModel
      );

      // Stocker les résultats de cette phase
      for (const [nodeId, voltage] of result.nodeVoltages) {
        if (!nodeVoltagesPerPhase.has(nodeId)) {
          nodeVoltagesPerPhase.set(nodeId, { A: C(0,0), B: C(0,0), C: C(0,0) });
        }
        const nodeVoltages = nodeVoltagesPerPhase.get(nodeId)!;
        if (phase.name === 'A') nodeVoltages.A = voltage;
        else if (phase.name === 'B') nodeVoltages.B = voltage;
        else if (phase.name === 'C') nodeVoltages.C = voltage;
      }

      for (const [cableId, current] of result.cableCurrents) {
        if (!cableCurrentsPerPhase.has(cableId)) {
          cableCurrentsPerPhase.set(cableId, { A: C(0,0), B: C(0,0), C: C(0,0) });
        }
        const cableCurrents = cableCurrentsPerPhase.get(cableId)!;
        if (phase.name === 'A') cableCurrents.A = current;
        else if (phase.name === 'B') cableCurrents.B = current;
        else if (phase.name === 'C') cableCurrents.C = current;
      }

      for (const [cableId, power] of result.cablePowers) {
        if (!cablePowersPerPhase.has(cableId)) {
          cablePowersPerPhase.set(cableId, { A: C(0,0), B: C(0,0), C: C(0,0) });
        }
        const cablePowers = cablePowersPerPhase.get(cableId)!;
        if (phase.name === 'A') cablePowers.A = power;
        else if (phase.name === 'B') cablePowers.B = power;
        else if (phase.name === 'C') cablePowers.C = power;
      }
    }

    // Agrégation des résultats finaux
    const nodeVoltageDrops = this.aggregateNodeMetrics(nodeVoltagesPerPhase, Vnom);
    const cableMetrics = this.aggregateCableMetrics(
      cableCurrentsPerPhase, 
      cablePowersPerPhase, 
      cables, 
      cableTypes, 
      Vnom
    );

    // Calcul des métriques par phase pour l'affichage
    const nodeVoltageDropsPerPhase = this.calculateNodeMetricsPerPhase(nodeVoltagesPerPhase, Vnom);

    console.log('✅ Calcul triphasé déséquilibré terminé');

    return {
      nodeVoltageDrops,
      cableMetrics,
      nodeVoltageDropsPerPhase, // Nouveau: métriques détaillées par phase
      timestamp: Date.now()
    };
  }

  /**
   * Calcul d'une phase spécifique avec angle donné
   */
  private calculateSinglePhaseWithAngle(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    source: Node,
    children: Map<string, string[]>,
    parent: Map<string, string>,
    parentCableOfChild: Map<string, Cable>,
    nodeById: Map<string, Node>,
    cableById: Map<string, Cable>,
    cableTypeMap: Map<string, CableType>,
    angleDeg: number,
    Vnom: number,
    loadModel: LoadModel
  ): {
    nodeVoltages: Map<string, Complex>,
    cableCurrents: Map<string, Complex>,
    cablePowers: Map<string, Complex>
  } {

    // Tension de référence avec angle de phase
    const angleRad = (angleDeg * Math.PI) / 180;
    const Vslack_phase_ph = C(Vnom * Math.cos(angleRad), Vnom * Math.sin(angleRad));

    console.log(`📐 Phase ${angleDeg}°: V_slack = ${abs(Vslack_phase_ph).toFixed(1)}V ∠${(Math.atan2(Vslack_phase_ph.im, Vslack_phase_ph.re) * 180 / Math.PI).toFixed(1)}°`);

    // Validation cosPhi
    const cosPhi_eff = Math.max(0.1, Math.min(1.0, this.cosPhi));
    if (!isFinite(this.cosPhi) || this.cosPhi < 0 || this.cosPhi > 1) {
      console.warn('⚠️ cosΦ hors [0,1], application d\'un clamp.', { cosPhi_in: this.cosPhi, cosPhi_eff });
    }
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi_eff * cosPhi_eff));

    // Calcul des puissances par nœud pour cette phase
    const S_node_phase_VA = new Map<string, Complex>();
    
    const computeNodeS = () => {
      for (const n of nodes) {
        if (n.isSource) {
          S_node_phase_VA.set(n.id, C(0, 0));
          continue;
        }

        // Calcul des puissances par phase selon le modèle de charge
        let S_charges_phase = C(0, 0);
        let S_productions_phase = C(0, 0);

        // Charges clients
        for (const ch of n.clients || []) {
          const P_phase = this.getPhaseActivePower(ch, angleDeg, loadModel);
          const Q_phase = P_phase * Math.tan(Math.acos(cosPhi_eff));
          S_charges_phase = add(S_charges_phase, C(P_phase, Q_phase));
        }

        // Productions PV
        for (const pv of n.productions || []) {
          const P_phase = this.getPhaseActivePower(pv, angleDeg, loadModel);
          const Q_phase = P_phase * Math.tan(Math.acos(cosPhi_eff));
          S_productions_phase = add(S_productions_phase, C(-P_phase, -Q_phase)); // Négatif pour injection
        }

        const S_net_phase = add(S_charges_phase, S_productions_phase);
        S_node_phase_VA.set(n.id, S_net_phase);
      }
    };
    computeNodeS();

    // Calcul des impédances de câbles pour cette phase
    const cableZ_phase = new Map<string, Complex>();
    for (const cab of cables) {
      const ct = cableTypeMap.get(cab.typeId);
      if (!ct) continue;
      
      const R_ohm_km = ct.resistance_ohm_km;
      const X_ohm_km = ct.reactance_ohm_km || 0.1;
      const Z_ohm = C(R_ohm_km * cab.longueur_m / 1000, X_ohm_km * cab.longueur_m / 1000);
      cableZ_phase.set(cab.id, Z_ohm);
    }

    // Configuration du transformateur (uniquement pour la phase A pour éviter la duplication)
    let Ztr_phase: Complex | null = null;
    if (angleDeg === 0 && source.transformerConfig?.enabled) {
      const tr = source.transformerConfig;
      const Sn_VA = tr.puissance_kVA * 1000;
      const Vn_V = tr.tensionPrimaire_V;
      const Zbase = (Vn_V * Vn_V) / Sn_VA;
      const Ztr_pu = C(tr.resistance_percent / 100, tr.reactance_percent / 100);
      Ztr_phase = mul(Ztr_pu, C(Zbase, 0));
      
      console.log(`🔌 Transformateur configuré: Ztr = ${abs(Ztr_phase).toFixed(4)}Ω`);
    }

    // Algorithme BFS itératif pour résolution load flow
    const maxIter = ElectricalCalculator.MAX_ITERATIONS;
    const tol = ElectricalCalculator.CONVERGENCE_TOLERANCE;
    let iter = 0;
    let converged = false;

    // Variables de calcul
    const V_node_phase = new Map<string, Complex>();
    const I_branch_phase = new Map<string, Complex>();
    const I_inj_node = new Map<string, Complex>();

    // Initialiser les tensions
    for (const n of nodes) {
      V_node_phase.set(n.id, Vslack_phase_ph);
    }

    while (iter < maxIter) {
      iter++;
      const V_prev = new Map(V_node_phase);

      // Backward sweep: calcul des courants
      const stack1 = [source.id];
      const visited1 = new Set<string>();
      
      while (stack1.length) {
        const u = stack1.pop()!;
        if (visited1.has(u)) continue;
        visited1.add(u);

        let canProcess = true;
        const childrenOfU = children.get(u) || [];
        
        for (const v of childrenOfU) {
          if (!visited1.has(v)) {
            canProcess = false;
            break;
          }
        }

        if (!canProcess) {
          stack1.push(u);
          for (const v of childrenOfU) {
            if (!visited1.has(v)) {
              stack1.push(v);
            }
          }
          continue;
        }

        // Calculer le courant d'injection au nœud u
        const Vu = V_node_phase.get(u) || Vslack_phase_ph;
        const Su = S_node_phase_VA.get(u) || C(0, 0);
        const Iu_injection = Su.re === 0 && Su.im === 0 ? C(0, 0) : 
          C(Su.re / abs(Vu), -Su.im / abs(Vu)); // I = S*/|V|

        // Somme des courants des branches enfants
        let I_children_sum = C(0, 0);
        for (const v of childrenOfU) {
          const cab = parentCableOfChild.get(v);
          if (cab) {
            const I_branch = I_branch_phase.get(cab.id) || C(0, 0);
            I_children_sum = add(I_children_sum, I_branch);
          }
        }

        const I_total = add(Iu_injection, I_children_sum);
        I_inj_node.set(u, I_total);

        // Propager le courant vers le parent
        if (parent.has(u)) {
          const parentCable = parentCableOfChild.get(u);
          if (parentCable) {
            I_branch_phase.set(parentCable.id, I_total);
          }
        }
      }

      // Forward sweep: calcul des tensions
      V_node_phase.set(source.id, Vslack_phase_ph);
      
      // Calcul de la tension au point de raccordement (après transformateur)
      const I_source_net = I_inj_node.get(source.id) || C(0, 0);
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
          
          // Calculer la tension avec transformation SRG2 si applicable
          let Vv = Vu.sub(Z.mul(Iuv));
          
          // Appliquer la transformation SRG2 si le nœud a un dispositif SRG2
          const vNode = nodeById.get(v);
          if (vNode?.hasSRG2Device && vNode.srg2VoltageCoefficients) {
            // Appliquer le coefficient de transformation pour cette phase
            let coefficient: number;
            if (angleDeg === 0) {
              // Phase A
              coefficient = vNode.srg2VoltageCoefficients.A;
            } else if (angleDeg === -120) {
              // Phase B  
              coefficient = vNode.srg2VoltageCoefficients.B;
            } else if (angleDeg === 120) {
              // Phase C
              coefficient = vNode.srg2VoltageCoefficients.C;
            } else {
              // Fallback - moyenne
              const avgCoeff = (vNode.srg2VoltageCoefficients.A + vNode.srg2VoltageCoefficients.B + vNode.srg2VoltageCoefficients.C) / 3;
              coefficient = avgCoeff;
            }
            
            // Appliquer la transformation: V_sortie = V_entrée * coefficient
            Vv = Vv.mul(C(coefficient, 0));
            
            console.log(`🎯 SRG2 transformation applied to node ${v}, phase ${angleDeg}°: coefficient=${coefficient.toFixed(4)}, V_out=${Vv.magnitude().toFixed(2)}V`);
          }
          
          V_node_phase.set(v, Vv);
          stack2.push(v);
        }
      }

      // Test de convergence
      let maxDiff = 0;
      for (const [nodeId, V_curr] of V_node_phase) {
        const V_prev_node = V_prev.get(nodeId) || C(0, 0);
        const diff = abs(sub(V_curr, V_prev_node));
        maxDiff = Math.max(maxDiff, diff);
      }

      if (maxDiff < tol) {
        converged = true;
        break;
      }
    }

    if (!converged) {
      console.warn(`⚠️ Convergence non atteinte après ${maxIter} itérations pour la phase ${angleDeg}°`);
    } else {
      console.log(`✅ Convergence atteinte en ${iter} itérations pour la phase ${angleDeg}°`);
    }

    // Calcul des puissances par câble
    const S_cable_phase = new Map<string, Complex>();
    for (const cab of cables) {
      const I = I_branch_phase.get(cab.id) || C(0, 0);
      const Vu = V_node_phase.get(cab.nodeAId) || Vslack_phase_ph;
      const S = mul(Vu, C(I.re, -I.im)); // S = V * I*
      S_cable_phase.set(cab.id, S);
    }

    return {
      nodeVoltages: V_node_phase,
      cableCurrents: I_branch_phase,
      cablePowers: S_cable_phase
    };
  }

  /**
   * Obtient la puissance active pour une phase donnée selon le modèle de charge
   */
  private getPhaseActivePower(
    element: ClientCharge | ProductionPV,
    angleDeg: number,
    loadModel: LoadModel
  ): number {
    const totalPower = 'puissance_kW' in element ? element.puissance_kW : element.puissanceNominale_kW;
    
    if (loadModel === 'monophase_reparti') {
      // En mode monophasé réparti, utiliser la distribution par phase si disponible
      if ('puissancePhaseA_kW' in element && element.puissancePhaseA_kW !== undefined) {
        if (angleDeg === 0) return element.puissancePhaseA_kW;
        else if (angleDeg === -120) return element.puissancePhaseB_kW || 0;
        else if (angleDeg === 120) return element.puissancePhaseC_kW || 0;
      }
      
      // Fallback: répartition équilibrée
      return totalPower / 3;
    } else {
      // Mode polyphasé équilibré: répartition égale sur les 3 phases
      return totalPower / 3;
    }
  }

  /**
   * Agrégation des métriques de nœuds à partir des résultats par phase
   */
  private aggregateNodeMetrics(
    nodeVoltagesPerPhase: Map<string, {A: Complex, B: Complex, C: Complex}>,
    Vnom: number
  ): { nodeId: string; V_phase_V: number; V_pu: number; I_inj_A: number; }[] {
    const nodeMetrics = [];
    
    for (const [nodeId, voltages] of nodeVoltagesPerPhase) {
      const V_A = abs(voltages.A);
      const V_B = abs(voltages.B);
      const V_C = abs(voltages.C);
      
      // Moyennes et écarts
      const V_avg = (V_A + V_B + V_C) / 3;
      const V_pu = V_avg / Vnom;
      
      nodeMetrics.push({
        nodeId,
        V_phase_V: V_avg,
        V_pu: V_pu,
        I_inj_A: 0 // Placeholder
      });
    }
    
    return nodeMetrics;
  }

  /**
   * Calcul des métriques par phase pour l'affichage détaillé
   */
  private calculateNodeMetricsPerPhase(
    nodeVoltagesPerPhase: Map<string, {A: Complex, B: Complex, C: Complex}>,
    Vnom: number
  ): { nodeId: string; voltagesPerPhase: { A: number; B: number; C: number; }; voltageDropsPerPhase: { A: number; B: number; C: number; }; }[] {
    const nodeMetricsPerPhase = [];
    
    for (const [nodeId, voltages] of nodeVoltagesPerPhase) {
      const V_A = abs(voltages.A);
      const V_B = abs(voltages.B);
      const V_C = abs(voltages.C);
      
      nodeMetricsPerPhase.push({
        nodeId,
        voltagesPerPhase: {
          A: V_A,
          B: V_B,
          C: V_C
        },
        voltageDropsPerPhase: {
          A: ((Vnom - V_A) / Vnom) * 100,
          B: ((Vnom - V_B) / Vnom) * 100,
          C: ((Vnom - V_C) / Vnom) * 100
        }
      });
    }
    
    return nodeMetricsPerPhase;
  }

  /**
   * Agrégation des métriques de câbles à partir des résultats par phase
   */
  private aggregateCableMetrics(
    cableCurrentsPerPhase: Map<string, {A: Complex, B: Complex, C: Complex}>,
    cablePowersPerPhase: Map<string, {A: Complex, B: Complex, C: Complex}>,
    cables: Cable[],
    cableTypes: CableType[],
    Vnom: number
  ): any[] {
    const cableMetrics = [];
    const cableTypeMap = new Map(cableTypes.map(ct => [ct.id, ct]));
    
    for (const cable of cables) {
      const currents = cableCurrentsPerPhase.get(cable.id);
      const powers = cablePowersPerPhase.get(cable.id);
      const cableType = cableTypeMap.get(cable.typeId);
      
      if (!currents || !powers || !cableType) continue;
      
      const I_A = abs(currents.A);
      const I_B = abs(currents.B);
      const I_C = abs(currents.C);
      
      const P_A = powers.A.re;
      const P_B = powers.B.re;
      const P_C = powers.C.re;
      
      const Q_A = powers.A.im;
      const Q_B = powers.B.im;
      const Q_C = powers.C.im;
      
      // Moyennes et totaux
      const I_avg = (I_A + I_B + I_C) / 3;
      const I_max = Math.max(I_A, I_B, I_C);
      const P_total = P_A + P_B + P_C;
      const Q_total = Q_A + Q_B + Q_C;
      const S_total = Math.sqrt(P_total * P_total + Q_total * Q_total);
      
      // Pertes et chute de tension
      const R_ohm = cableType.resistanceLineique_ohm_km * cable.length_m / 1000;
      const losses_W = R_ohm * (I_A * I_A + I_B * I_B + I_C * I_C);
      const voltage_drop_V = R_ohm * I_max;
      const voltage_drop_percent = (voltage_drop_V / Vnom) * 100;
      
      // Densité de courant et conformité
      const current_density = I_max / cableType.section_mm2;
      const isCurrentCompliant = current_density <= ElectricalCalculator.MAX_CURRENT_DENSITY;
      const isVoltageDropCompliant = voltage_drop_percent <= 5; // Limite 5%
      
      cableMetrics.push({
        cableId: cable.id,
        I_A: I_avg,
        I_max: I_max,
        P_kW: P_total / 1000,
        Q_kVAr: Q_total / 1000,
        S_kVA: S_total / 1000,
        losses_W: losses_W,
        voltage_drop_V: voltage_drop_V,
        voltage_drop_percent: voltage_drop_percent,
        current_density: current_density,
        isCurrentCompliant,
        isVoltageDropCompliant
      });
    }
    
    return cableMetrics;
  }

  /**
   * Calcul monophasé équilibré classique (méthode existante)
   */
  private calculateSinglePhase(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    voltageSystem: VoltageSystem
  ): CalculationResult {
    console.log('🔄 Début du calcul monophasé équilibré');
    
    // Implementation simplifiée pour le calcul équilibré
    const nodeVoltageDrops = [];
    const cableMetrics = [];
    
    // Placeholder - utiliser l'implémentation existante
    for (const node of nodes) {
      nodeVoltageDrops.push({
        nodeId: node.id,
        V_phase_V: 230,
        V_pu: 1.0,
        I_inj_A: 0
      });
    }
    
    for (const cable of cables) {
      cableMetrics.push({
        cableId: cable.id,
        I_A: 0,
        P_kW: 0,
        voltage_drop_percent: 0,
        isCurrentCompliant: true,
        isVoltageDropCompliant: true
      });
    }
    
    return {
      nodeVoltageDrops,
      cableMetrics,
      timestamp: Date.now()
    };
  }

  // ... autres méthodes utilitaires

  /**
   * Prépare les données selon le scénario choisi
   */
  private prepareScenarioData(
    nodes: Node[],
    cables: Cable[],
    scenario: CalculationScenario,
    foisonnementCharges: number,
    foisonnementProductions: number,
    desequilibrePourcent: number
  ): { processedNodes: Node[], processedCables: Cable[] } {
    
    const processedNodes = nodes.map(node => {
      const newNode = { ...node };
      
      // Appliquer le foisonnement sur les charges
      if (newNode.clients) {
        newNode.clients = newNode.clients.map(charge => ({
          ...charge,
          puissance_kW: charge.puissance_kW * (foisonnementCharges / 100)
        }));
      }
      
      // Appliquer le foisonnement sur les productions selon le scénario
      if (newNode.productions) {
        let productionFactor = 0;
        
        switch (scenario) {
          case 'PRÉLÈVEMENT':
            productionFactor = 0.1; // Très faible production
            break;
          case 'PRODUCTION':
            productionFactor = 1.0; // Production maximale
            break;
          case 'MIXTE':
            productionFactor = 0.5; // Production moyenne
            break;
          case 'FORCÉ':
            productionFactor = 0.7; // Production selon configuration forcée
            break;
          default:
            productionFactor = 0.5;
        }
        
        newNode.productions = newNode.productions.map(production => ({
          ...production,
          puissance_kW: production.puissance_kW * productionFactor * (foisonnementProductions / 100)
        }));
      }
      
      return newNode;
    });
    
    return {
      processedNodes,
      processedCables: cables
    };
  }

  /**
   * Construit la topologie du réseau
   */
  private buildNetworkTopology(nodes: Node[], cables: Cable[]): {
    children: Map<string, string[]>,
    parent: Map<string, string>,
    parentCableOfChild: Map<string, Cable>
  } {
    
    const children = new Map<string, string[]>();
    const parent = new Map<string, string>();
    const parentCableOfChild = new Map<string, Cable>();
    
    // Initialiser les listes d'enfants
    for (const node of nodes) {
      children.set(node.id, []);
    }
    
    // Construire la topologie à partir des câbles
    for (const cable of cables) {
      const nodeA = cable.nodeAId;
      const nodeB = cable.nodeBId;
      
      // Déterminer le sens (source vers charge)
      const nodeAObj = nodes.find(n => n.id === nodeA);
      const nodeBObj = nodes.find(n => n.id === nodeB);
      
      if (nodeAObj?.isSource) {
        // A est source, B est enfant
        children.get(nodeA)?.push(nodeB);
        parent.set(nodeB, nodeA);
        parentCableOfChild.set(nodeB, cable);
      } else if (nodeBObj?.isSource) {
        // B est source, A est enfant
        children.get(nodeB)?.push(nodeA);
        parent.set(nodeA, nodeB);
        parentCableOfChild.set(nodeA, cable);
      } else {
        // Ni A ni B n'est source - utiliser le premier comme parent par défaut
        children.get(nodeA)?.push(nodeB);
        parent.set(nodeB, nodeA);
        parentCableOfChild.set(nodeB, cable);
      }
    }
    
    return { children, parent, parentCableOfChild };
  }

  /**
   * Calcule les métriques globales
   */
  private calculateGlobalMetrics(result: CalculationResult, voltageSystem: VoltageSystem): {
    totalPowerLosses: number,
    totalApparentPower: number,
    totalActivePower: number,
    totalReactivePower: number,
    averageVoltage: number,
    minVoltage: number,
    maxVoltage: number,
    voltageCompliance: number,
    currentCompliance: number
  } {
    
    let totalPowerLosses = 0;
    let totalApparentPower = 0;
    let totalActivePower = 0;
    let totalReactivePower = 0;
    
    let voltageSum = 0;
    let voltageCount = 0;
    let minVoltage = Infinity;
    let maxVoltage = -Infinity;
    let compliantVoltages = 0;
    let compliantCurrents = 0;
    let totalCables = 0;
    
    // Métriques des câbles
    for (const metrics of result.cableMetrics || []) {
      totalPowerLosses += metrics.losses_W || 0;
      totalApparentPower += (metrics.S_kVA || 0) * 1000;
      totalActivePower += (metrics.P_kW || 0) * 1000;
      totalReactivePower += (metrics.Q_kVAr || 0) * 1000;
      
      if (metrics.isCurrentCompliant) compliantCurrents++;
      totalCables++;
    }
    
    // Métriques des nœuds
    for (const metrics of result.nodeVoltageDrops || []) {
      const voltage = metrics.V_phase_V || 0;
      voltageSum += voltage;
      voltageCount++;
      
      minVoltage = Math.min(minVoltage, voltage);
      maxVoltage = Math.max(maxVoltage, voltage);
      
      const V_pu = metrics.V_pu || 0;
      if (V_pu >= 0.95 && V_pu <= 1.05) compliantVoltages++;
    }
    
    return {
      totalPowerLosses: totalPowerLosses / 1000, // en kW
      totalApparentPower: totalApparentPower / 1000, // en kVA
      totalActivePower: totalActivePower / 1000, // en kW
      totalReactivePower: totalReactivePower / 1000, // en kVAr
      averageVoltage: voltageCount > 0 ? voltageSum / voltageCount : 0,
      minVoltage: minVoltage === Infinity ? 0 : minVoltage,
      maxVoltage: maxVoltage === -Infinity ? 0 : maxVoltage,
      voltageCompliance: voltageCount > 0 ? (compliantVoltages / voltageCount) * 100 : 100,
      currentCompliance: totalCables > 0 ? (compliantCurrents / totalCables) * 100 : 100
    };
  }

  /**
   * Calcule le bus virtuel
   */
  private calculateVirtualBusbar(nodes: Node[], scenario: CalculationScenario, voltageSystem: VoltageSystem): any {
    // Implementation simplifiée du bus virtuel
    const totalCharges = nodes.reduce((sum, node) => {
      return sum + (node.clients?.reduce((nodeSum, charge) => nodeSum + charge.puissance_kW, 0) || 0);
    }, 0);
    
    const totalProductions = nodes.reduce((sum, node) => {
      return sum + (node.productions?.reduce((nodeSum, prod) => nodeSum + prod.puissance_kW, 0) || 0);
    }, 0);
    
    return {
      tension_V: voltageSystem === '400V' ? 400 : 400,
      puissance_charges_kW: totalCharges,
      puissance_productions_kW: totalProductions,
      puissance_nette_kW: totalCharges - totalProductions,
      scenario
    };
  }

  /**
   * Validation des paramètres d'entrée
   */
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