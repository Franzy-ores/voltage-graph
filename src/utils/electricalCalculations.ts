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
   * Legacy method for backward compatibility
   */
  calculateScenario(
    nodes: Node[], 
    cables: Cable[], 
    cableTypes: CableType[], 
    scenario: CalculationScenario,
    foisonnementCharges: number = 100, 
    foisonnementProductions: number = 100,
    transformer: TransformerConfig,
    loadModel: LoadModel = 'polyphase_equilibre',
    desequilibrePourcent: number = 0,
    manualPhaseDistribution?: any
  ): CalculationResult {
    const mockProject: Project = {
      id: 'temp', name: 'temp', voltageSystem: 'TÉTRAPHASÉ_400V',
      cosPhi: this.cosPhi, foisonnementCharges, foisonnementProductions,
      defaultChargeKVA: 5, defaultProductionKVA: 5, transformerConfig: transformer,
      loadModel, desequilibrePourcent, nodes, cables, cableTypes
    };
    return this.calculateScenarioWithHTConfig(mockProject, scenario, foisonnementCharges, foisonnementProductions, manualPhaseDistribution);
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
    } = this.calculateGlobalMetrics(result, project);

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
    const isVoltageSystem400V = voltageSystem === 'TÉTRAPHASÉ_400V';
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
    const updatedCables = this.aggregateCableMetrics(
      cableCurrentsPerPhase, 
      cablePowersPerPhase, 
      cables, 
      cableTypes, 
      Vnom
    );

    // Calcul des métriques par phase pour l'affichage
    const nodeMetricsPerPhase = this.calculateNodeMetricsPerPhase(nodeVoltagesPerPhase, Vnom);

    console.log('✅ Calcul triphasé déséquilibré terminé');

    return {
      scenario: 'PRÉLÈVEMENT',
      cables: updatedCables,
      totalLoads_kVA: 0,
      totalProductions_kVA: 0,
      globalLosses_kW: 0,
      maxVoltageDropPercent: 0,
      compliance: 'normal',
      nodeVoltageDrops,
      nodeMetricsPerPhase
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
      
      const R_ohm_km = ct.R12_ohm_per_km;
      const X_ohm_km = ct.X12_ohm_per_km || 0.1;
      const Z_ohm = C(R_ohm_km * (cab.length_m || 0) / 1000, X_ohm_km * (cab.length_m || 0) / 1000);
      cableZ_phase.set(cab.id, Z_ohm);
    }

    // Configuration du transformateur (uniquement pour la phase A pour éviter la duplication)
    let Ztr_phase: Complex | null = null;
    // Note: transformer config is on project level, not node level
    // For now, disable transformer impedance in per-phase calculations

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
          let Vv = sub(Vu, mul(Z, Iuv));
          
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
            Vv = mul(Vv, C(coefficient, 0));
            
            console.log(`🎯 SRG2 transformation applied to node ${v}, phase ${angleDeg}°: coefficient=${coefficient.toFixed(4)}, V_out=${abs(Vv).toFixed(2)}V`);
          }
          
          V_node_phase.set(v, Vv);
          stack2.push(v);
        }
      }

      // Check convergence
      let maxChange = 0;
      for (const [nodeId, V_new] of V_node_phase) {
        const V_old = V_prev.get(nodeId) || C(0, 0);
        const change = abs(sub(V_new, V_old));
        maxChange = Math.max(maxChange, change);
      }

      if (maxChange < tol) {
        converged = true;
        break;
      }
    }

    console.log(`🔄 Convergence ${converged ? 'atteinte' : 'NON atteinte'} en ${iter} itérations (angle=${angleDeg}°)`);

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
    // Use S_kVA from element and apply cosPhi to get kW
    const totalPowerKW = element.S_kVA * this.cosPhi;
    
    if (loadModel === 'monophase_reparti') {
      // For unbalanced loads, check if phase-specific distribution exists
      const elementAny = element as any;
      if (elementAny.puissancePhaseA_kW !== undefined) {
        if (angleDeg === 0) return elementAny.puissancePhaseA_kW || 0;
        else if (angleDeg === -120) return elementAny.puissancePhaseB_kW || 0;
        else if (angleDeg === 120) return elementAny.puissancePhaseC_kW || 0;
      }
      
      // Fallback: equal distribution
      return totalPowerKW / 3;
    } else {
      // Balanced polyphase mode: equal distribution across 3 phases
      return totalPowerKW / 3;
    }
  }

  /**
   * Agrégation des métriques de nœuds à partir des résultats par phase
   */
  private aggregateNodeMetrics(
    nodeVoltagesPerPhase: Map<string, {A: Complex, B: Complex, C: Complex}>,
    Vnom: number
  ): { nodeId: string; deltaU_cum_V: number; deltaU_cum_percent: number; }[] {
    const nodeMetrics = [];

    for (const [nodeId, voltages] of nodeVoltagesPerPhase) {
      // Calculate average voltage magnitude
      const V_A = abs(voltages.A);
      const V_B = abs(voltages.B);
      const V_C = abs(voltages.C);
      const V_avg = (V_A + V_B + V_C) / 3;
      
      // Calculate voltage drop (nominal - actual)
      const deltaU_V = Vnom - V_avg;
      const deltaU_percent = (deltaU_V / Vnom) * 100;

      nodeMetrics.push({
        nodeId,
        deltaU_cum_V: deltaU_V,
        deltaU_cum_percent: deltaU_percent
      });
    }

    return nodeMetrics;
  }

  /**
   * Calcul des métriques détaillées par phase pour chaque nœud
   */
  private calculateNodeMetricsPerPhase(
    nodeVoltagesPerPhase: Map<string, {A: Complex, B: Complex, C: Complex}>,
    Vnom: number
  ): { nodeId: string; voltagesPerPhase: { A: number; B: number; C: number }; voltageDropsPerPhase: { A: number; B: number; C: number }; }[] {
    const nodeMetricsPerPhase = [];

    for (const [nodeId, voltages] of nodeVoltagesPerPhase) {
      const V_A = abs(voltages.A);
      const V_B = abs(voltages.B);
      const V_C = abs(voltages.C);
      
      const deltaU_A = Vnom - V_A;
      const deltaU_B = Vnom - V_B;
      const deltaU_C = Vnom - V_C;

      nodeMetricsPerPhase.push({
        nodeId,
        voltagesPerPhase: { A: V_A, B: V_B, C: V_C },
        voltageDropsPerPhase: { A: deltaU_A, B: deltaU_B, C: deltaU_C }
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
  ): Cable[] {
    const cableTypeMap = new Map(cableTypes.map(ct => [ct.id, ct]));
    const updatedCables = cables.map(cable => ({ ...cable }));

    for (const cable of updatedCables) {
      const cableType = cableTypeMap.get(cable.typeId);
      if (!cableType) continue;

      const currents = cableCurrentsPerPhase.get(cable.id);
      const powers = cablePowersPerPhase.get(cable.id);
      
      if (!currents || !powers) continue;

      // Calcul des courants RMS par phase
      const I_A = abs(currents.A);
      const I_B = abs(currents.B);
      const I_C = abs(currents.C);

      // Calcul des puissances par phase
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
      const R_ohm = cableType.R12_ohm_per_km * (cable.length_m || 0) / 1000;
      const losses_W = R_ohm * (I_A * I_A + I_B * I_B + I_C * I_C);
      const voltage_drop_V = R_ohm * I_max;
      const voltage_drop_percent = (voltage_drop_V / Vnom) * 100;
      
      // Densité de courant et conformité
      const current_density = I_max / (cableType.maxCurrent_A || 100);
      const isCurrentCompliant = current_density <= ElectricalCalculator.MAX_CURRENT_DENSITY;
      const isVoltageDropCompliant = voltage_drop_percent <= 5; // Limite 5%
      
      // Mettre à jour le câble avec les résultats
      cable.current_A = I_avg;
      cable.voltageDrop_V = voltage_drop_V;
      cable.voltageDropPercent = voltage_drop_percent;
      cable.losses_kW = losses_W / 1000;
      cable.apparentPower_kVA = S_total / 1000;
      cable.currentsPerPhase_A = { A: I_A, B: I_B, C: I_C };
      cable.voltageDropPerPhase_V = { A: voltage_drop_V, B: voltage_drop_V, C: voltage_drop_V };
    }

    return updatedCables;
  }

  /**
   * Calcul monophasé équilibré (méthode simplifiée)
   */
  private calculateSinglePhase(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    voltageSystem: VoltageSystem
  ): CalculationResult {
    // Simplified single-phase calculation
    const nodeVoltageDrops = nodes.map(node => ({
      nodeId: node.id,
      deltaU_cum_V: 0,
      deltaU_cum_percent: 0
    }));

    const updatedCables = cables.map(cable => ({
      ...cable,
      current_A: 0,
      voltageDrop_V: 0,
      voltageDropPercent: 0,
      losses_kW: 0,
      apparentPower_kVA: 0
    }));

    return {
      scenario: 'PRÉLÈVEMENT',
      cables: updatedCables,
      totalLoads_kVA: 0,
      totalProductions_kVA: 0,
      globalLosses_kW: 0,
      maxVoltageDropPercent: 0,
      compliance: 'normal',
      nodeVoltageDrops
    };
  }

  /**
   * Préparation des données selon le scénario
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
          S_kVA: charge.S_kVA * (foisonnementCharges / 100)
        }));
      }
      
      // Appliquer le foisonnement sur les productions selon le scénario
      if (newNode.productions) {
        let productionFactor = 0;
        
        switch (scenario) {
          case 'PRÉLÈVEMENT':
            productionFactor = 0; // Pas de production
            break;
          case 'MIXTE':
            productionFactor = foisonnementProductions / 2; // 50% de la production
            break;
          case 'PRODUCTION':
            productionFactor = foisonnementProductions; // Production complète
            break;
          case 'FORCÉ':
            productionFactor = foisonnementProductions; // Utiliser le facteur donné
            break;
        }
        
        if (productionFactor > 0) {
          newNode.productions = newNode.productions.map(prod => ({
            ...prod,
            S_kVA: prod.S_kVA * (productionFactor / 100)
          }));
        } else {
          newNode.productions = newNode.productions.map(prod => ({
            ...prod,
            S_kVA: 0
          }));
        }
      }
      
      return newNode;
    });

    // Calculate cable lengths if not set
    const processedCables = cables.map(cable => ({
      ...cable,
      length_m: cable.length_m || ElectricalCalculator.calculateCableLength(cable.coordinates)
    }));

    return { processedNodes, processedCables };
  }

  /**
   * Construction de la topologie du réseau
   */
  private buildNetworkTopology(nodes: Node[], cables: Cable[]): {
    children: Map<string, string[]>,
    parent: Map<string, string>,
    parentCableOfChild: Map<string, Cable>
  } {
    const children = new Map<string, string[]>();
    const parent = new Map<string, string>();
    const parentCableOfChild = new Map<string, Cable>();

    // Initialize children map
    for (const node of nodes) {
      children.set(node.id, []);
    }

    // Build topology from cables
    for (const cable of cables) {
      const nodeA = nodes.find(n => n.id === cable.nodeAId);
      const nodeB = nodes.find(n => n.id === cable.nodeBId);
      
      if (!nodeA || !nodeB) continue;

      // Determine parent-child relationship (source is always parent)
      if (nodeA.isSource) {
        children.get(nodeA.id)?.push(nodeB.id);
        parent.set(nodeB.id, nodeA.id);
        parentCableOfChild.set(nodeB.id, cable);
      } else if (nodeB.isSource) {
        children.get(nodeB.id)?.push(nodeA.id);
        parent.set(nodeA.id, nodeB.id);
        parentCableOfChild.set(nodeA.id, cable);
      } else {
        // If neither is source, assume nodeA is upstream
        children.get(nodeA.id)?.push(nodeB.id);
        parent.set(nodeB.id, nodeA.id);
        parentCableOfChild.set(nodeB.id, cable);
      }
    }

    return { children, parent, parentCableOfChild };
  }

  /**
   * Calcul des métriques globales du réseau
   */
  private calculateGlobalMetrics(
    result: CalculationResult,
    project: Project
  ): {
    totalPowerLosses: number,
    totalApparentPower: number,
    totalActivePower: number,
    totalReactivePower: number,
    averageVoltage: number,
    minVoltage: number,
    maxVoltage: number,
    voltageCompliance: 'normal' | 'warning' | 'critical',
    currentCompliance: 'normal' | 'warning' | 'critical'
  } {
    let totalPowerLosses = 0;
    let totalApparentPower = 0;
    let totalActivePower = 0;
    let totalReactivePower = 0;
    let minVoltage_V = Number.MAX_VALUE;
    let maxVoltage_V = Number.MIN_VALUE;
    let totalLoads_kVA = 0;
    let totalProductions_kVA = 0;

    // Calculate cable losses
    const cableMetrics = result.cables || [];
    for (const cable of cableMetrics) {
      totalPowerLosses += cable.losses_kW || 0;
      totalApparentPower += cable.apparentPower_kVA || 0;
    }

    // Calculate voltage metrics from node voltage drops
    for (const nodeMetric of result.nodeVoltageDrops || []) {
      // Use deltaU_cum_V for voltage calculations
      const nominalVoltage_V = project.transformerConfig?.nominalVoltage_V || 400;
      const voltage_V = nominalVoltage_V - Math.abs(nodeMetric.deltaU_cum_V);
      
      if (voltage_V < minVoltage_V) minVoltage_V = voltage_V;
      if (voltage_V > maxVoltage_V) maxVoltage_V = voltage_V;
      
      const voltageDeviation_percent = Math.abs(nodeMetric.deltaU_cum_percent);
      if (voltageDeviation_percent > 5) {
        // Voltage compliance issues
      }
    }

    const averageVoltage = (minVoltage_V + maxVoltage_V) / 2;

    // Determine compliance levels
    const voltageDeviation = Math.abs(averageVoltage - (project.transformerConfig?.nominalVoltage_V || 400)) / (project.transformerConfig?.nominalVoltage_V || 400) * 100;
    let voltageCompliance: 'normal' | 'warning' | 'critical' = 'normal';
    if (voltageDeviation > 10) voltageCompliance = 'critical';
    else if (voltageDeviation > 5) voltageCompliance = 'warning';

    // Calculate total loads and productions
    for (const node of project.nodes) {
      for (const client of node.clients || []) {
        totalLoads_kVA += client.S_kVA || 0;
      }
      for (const prod of node.productions || []) {
        totalProductions_kVA += prod.S_kVA || 0;
      }
    }

    // Get nominal voltage for busbar calculation
    const nominalVoltage_V = (project.voltageSystem === "TÉTRAPHASÉ_400V") ? 400 : 230;
    
    return {
      totalPowerLosses,
      totalApparentPower,
      totalActivePower: totalLoads_kVA * this.cosPhi,
      totalReactivePower: totalLoads_kVA * Math.sin(Math.acos(this.cosPhi)),
      averageVoltage,
      minVoltage: minVoltage_V,
      maxVoltage: maxVoltage_V,
      voltageCompliance,
      currentCompliance: 'normal' // Simplified for now
    };
  }

  /**
   * Calcul du jeu de barres virtuel
   */
  private calculateVirtualBusbar(
    nodes: Node[],
    scenario: CalculationScenario,
    voltageSystem: VoltageSystem
  ): any {
    let totalCharges_kVA = 0;
    let totalProductions_kVA = 0;
    
    for (const node of nodes) {
      for (const client of node.clients || []) {
        totalCharges_kVA += client.S_kVA || 0;
      }
      for (const prod of node.productions || []) {
        totalProductions_kVA += prod.S_kVA || 0;
      }
    }

    const netSkVA = totalCharges_kVA - totalProductions_kVA;
    const nominalVoltage_V = (voltageSystem === "TÉTRAPHASÉ_400V") ? 400 : 230;
    
    return {
      voltage_V: nominalVoltage_V,
      current_A: Math.abs(netSkVA * 1000 / (Math.sqrt(3) * nominalVoltage_V)),
      netSkVA,
      deltaU_V: 0,
      deltaU_percent: 0,
      circuits: []
    };
  }

  /**
   * Validation des entrées
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
      throw new Error('Aucun nœud défini dans le réseau');
    }

    if (!cables || cables.length === 0) {
      throw new Error('Aucun câble défini dans le réseau');
    }

    if (!cableTypes || cableTypes.length === 0) {
      throw new Error('Aucun type de câble défini');
    }

    const sourceNodes = nodes.filter(n => n.isSource);
    if (sourceNodes.length !== 1) {
      throw new Error(`Exactement une source requise, trouvé: ${sourceNodes.length}`);
    }

    if (foisonnementCharges < 0 || foisonnementCharges > 200) {
      throw new Error('Foisonnement des charges doit être entre 0 et 200%');
    }

    if (foisonnementProductions < 0 || foisonnementProductions > 200) {
      throw new Error('Foisonnement des productions doit être entre 0 et 200%');
    }

    console.log('✅ Validation des entrées réussie');
  }
}