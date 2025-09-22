import { Complex, mul, scale } from '@/utils/complex';
import { Node, Cable, Project } from '@/types/network';

/**
 * SRG2Regulator - Régulateur de tension secondaire
 * 
 * IMPORTANT: Tout usage de ce régulateur doit passer exclusivement par
 * SimulationCalculator.applySrg2IfNeeded() pour éviter les calculs multiples.
 * 
 * Ne jamais appeler directement SRG2Regulator.apply() depuis d'autres parties du code.
 */

export interface SRG2State {
  state: 'LO2' | 'LO1' | 'BYP' | 'BO1' | 'BO2' | 'WAIT';
  ratio: number;
  voltage: number;
  timestamp: number;
}

export interface SRG2Config {
  nodeId: string;
  enabled: boolean;
  // networkType is derived from project.voltageSystem, no longer configurable
  // Fixed power limits: 85 kVA injection, 100 kVA consumption
}

export interface SRG2Result {
  nodeId: string;
  originalVoltage: number;
  regulatedVoltage: number;
  state: string;
  ratio: number;
  phaseRatios?: { A: number; B: number; C: number };
  powerDownstream_kVA: number;
  diversifiedLoad_kVA?: number;        // Charge foisonnée
  diversifiedProduction_kVA?: number;  // Production foisonnée
  netPower_kVA?: number;              // Puissance nette downstream  
  networkType?: '230V' | '400V';      // Type réseau dérivé
  isActive: boolean;
  limitReason?: string;
}

export class SRG2Regulator {
  private lastSwitchTimes = new Map<string, number>();
  private currentStates = new Map<string, SRG2State>();
  private readonly hysteresis = 2; // volts
  private readonly switchDelay = 7_000; // ms (7 s)

  /** Thresholds for voltage regulation */
  private getThresholds(network: '230V' | '400V') {
    return network === '400V'
      ? { UL: 416, LO1: 408, BO1: 392, UB: 384, nominal: 400 }
      : { UL: 246, LO1: 238, BO1: 222, UB: 214, nominal: 230 };
  }

  /** Compute SRG2 state based on voltage and hysteresis */
  private computeState(
    voltage: number,
    network: '230V' | '400V',
    currentState?: SRG2State
  ): { state: string; ratio: number } {
    const thresholds = this.getThresholds(network);
    
    // Apply hysteresis if we have a current state
    const hysteresisAdjusted = currentState ? {
      UL: thresholds.UL + (currentState.state === 'LO2' ? -this.hysteresis : this.hysteresis),
      LO1: thresholds.LO1 + (currentState.state === 'LO1' ? -this.hysteresis : this.hysteresis),
      BO1: thresholds.BO1 + (currentState.state === 'BO1' ? -this.hysteresis : this.hysteresis),
      UB: thresholds.UB + (currentState.state === 'BO2' ? this.hysteresis : -this.hysteresis)
    } : thresholds;

    if (voltage >= hysteresisAdjusted.UL) return { state: 'LO2', ratio: 0.93 };
    if (voltage >= hysteresisAdjusted.LO1) return { state: 'LO1', ratio: 0.965 };
    if (voltage <= hysteresisAdjusted.UB) return { state: 'BO2', ratio: 1.07 };
    if (voltage <= hysteresisAdjusted.BO1) return { state: 'BO1', ratio: 1.035 };
    return { state: 'BYP', ratio: 1.0 };
  }

  /** Calculate downstream power with diversity factors */
  private calculateDownstreamPower(
    node: Node,
    project: Project
  ): {
    totalPower_kVA: number;
    diversifiedLoad_kVA: number;
    diversifiedProduction_kVA: number;
    netPower_kVA: number;
  } {
    let directLoad = 0;
    let directProduction = 0;

    // Add direct loads  
    if (node.clients) {
      directLoad = node.clients.reduce((sum, client) => sum + (client.S_kVA || 0), 0);
    }

    // Add direct productions
    if (node.productions) {
      directProduction = node.productions.reduce((sum, prod) => sum + (prod.S_kVA || 0), 0);
    }

    // Apply diversity factors
    const diversifiedLoad = directLoad * (project.foisonnementCharges / 100);
    const diversifiedProduction = directProduction * (project.foisonnementProductions / 100);
    
    // Net power (load - production)
    const netPower = diversifiedLoad - diversifiedProduction;

    // TODO: Add downstream nodes calculation via cable connections
    // This would require traversing the network graph

    return {
      totalPower_kVA: Math.abs(netPower),
      diversifiedLoad_kVA: diversifiedLoad,
      diversifiedProduction_kVA: diversifiedProduction,
      netPower_kVA: netPower
    };
  }

  /** Check if SRG2 can be applied based on fixed power limits */
  private canApplySRG2(
    node: Node,
    project: Project
  ): { canApply: boolean; reason?: string; powerCalc: ReturnType<typeof this.calculateDownstreamPower> } {
    const powerCalc = this.calculateDownstreamPower(node, project);
    const maxConsumption = 100; // Fixed limit: 100 kVA
    
    if (powerCalc.totalPower_kVA > maxConsumption) {
      return {
        canApply: false,
        reason: `Downstream power (${powerCalc.totalPower_kVA.toFixed(1)} kVA) exceeds limit (${maxConsumption} kVA)`,
        powerCalc
      };
    }

    return { canApply: true, powerCalc };
  }

  /** Apply SRG2 regulation to a node */
  apply(
    config: SRG2Config,
    node: Node,
    project: Project,
    actualVoltages?: { A: number; B: number; C: number },
    now: number = Date.now()
  ): SRG2Result {
    console.log(`🔧 SRG2: Evaluating node ${node.id}`);

    // Derive network type from project voltage system
    const networkType: '230V' | '400V' = project.voltageSystem === 'TRIPHASÉ_230V' ? '230V' : '400V';

    // Check if SRG2 can be applied
    const powerCheck = this.canApplySRG2(node, project);
    if (!powerCheck.canApply) {
      console.log(`⚠️ SRG2: Cannot apply - ${powerCheck.reason}`);
      return {
        nodeId: node.id,
        originalVoltage: node.tensionCible || project.transformerConfig?.nominalVoltage_V || 230,
        regulatedVoltage: node.tensionCible || project.transformerConfig?.nominalVoltage_V || 230,
        state: 'DISABLED',
        ratio: 1.0,
        powerDownstream_kVA: powerCheck.powerCalc.totalPower_kVA,
        diversifiedLoad_kVA: powerCheck.powerCalc.diversifiedLoad_kVA,
        diversifiedProduction_kVA: powerCheck.powerCalc.diversifiedProduction_kVA,
        netPower_kVA: powerCheck.powerCalc.netPower_kVA,
        networkType,
        isActive: false,
        limitReason: powerCheck.reason
      };
    }

    // Use actual calculated voltage if provided, otherwise fall back to tensionCible
    const feedVoltage = actualVoltages 
      ? (actualVoltages.A + actualVoltages.B + actualVoltages.C) / 3  // Average of phases
      : node.tensionCible ?? project.transformerConfig?.nominalVoltage_V ?? 230;
    
    const currentState = this.currentStates.get(node.id);
    const lastSwitch = this.lastSwitchTimes.get(node.id) ?? 0;

    // Compute new state based on actual voltage
    const { state, ratio } = this.computeState(feedVoltage, networkType, currentState);
    
    // Trace détaillée des valeurs critiques
    console.log(`[SRG2] Node ${node.id} → actualV=${actualVoltages ? `${actualVoltages.A.toFixed(1)}/${actualVoltages.B.toFixed(1)}/${actualVoltages.C.toFixed(1)}V` : 'N/A'} | avgV=${feedVoltage.toFixed(1)}V | state=${state} | ratio=${ratio}`);

    // Check timing constraint
    if (currentState && currentState.state !== state && (now - lastSwitch) < this.switchDelay) {
      console.log(`⏳ SRG2: State change delayed (${((now - lastSwitch) / 1000).toFixed(1)}s < 7s)`);
      return {
        nodeId: node.id,
        originalVoltage: feedVoltage,
        regulatedVoltage: feedVoltage,
        state: 'WAIT',
        ratio: 1.0,
        powerDownstream_kVA: powerCheck.powerCalc.totalPower_kVA,
        diversifiedLoad_kVA: powerCheck.powerCalc.diversifiedLoad_kVA,
        diversifiedProduction_kVA: powerCheck.powerCalc.diversifiedProduction_kVA,
        netPower_kVA: powerCheck.powerCalc.netPower_kVA,
        networkType,
        isActive: false
      };
    }

    // Update state if changed
    if (!currentState || currentState.state !== state) {
      this.lastSwitchTimes.set(node.id, now);
      this.currentStates.set(node.id, {
        state: state as any,
        ratio,
        voltage: feedVoltage,
        timestamp: now
      });
      console.log(`🔄 SRG2: State change ${node.id}: ${currentState?.state || 'INIT'} → ${state} (ratio: ${ratio})`);
    }

    const regulatedVoltage = feedVoltage * ratio;

    // For 400V systems, calculate per-phase ratios (simplified - same ratio for all phases)
    const phaseRatios = networkType === '400V' 
      ? { A: ratio, B: ratio, C: ratio }
      : undefined;

    console.log(`✅ SRG2: Applied on ${node.id}: ${feedVoltage}V → ${regulatedVoltage.toFixed(1)}V (${state})`);

    return {
      nodeId: node.id,
      originalVoltage: feedVoltage,
      regulatedVoltage,
      state,
      ratio,
      phaseRatios,
      powerDownstream_kVA: powerCheck.powerCalc.totalPower_kVA,
      diversifiedLoad_kVA: powerCheck.powerCalc.diversifiedLoad_kVA,
      diversifiedProduction_kVA: powerCheck.powerCalc.diversifiedProduction_kVA,
      netPower_kVA: powerCheck.powerCalc.netPower_kVA,
      networkType,
      isActive: true
    };
  }

  /** Reset SRG2 state for a node */
  reset(nodeId: string): void {
    this.lastSwitchTimes.delete(nodeId);
    this.currentStates.delete(nodeId);
    console.log(`🔄 SRG2: Reset state for node ${nodeId}`);
  }

  /** Get current state for a node */
  getCurrentState(nodeId: string): SRG2State | undefined {
    return this.currentStates.get(nodeId);
  }

  /**
   * Applique la régulation SRG2 à l'ensemble du réseau.
   * - Met à jour le nœud ciblé.
   * - Propage le ratio de tension en aval (et optionnellement en amont).
   *
   * @param result   Résultat SRG2 (contient le ratio)
   * @param nodes    Liste complète des nœuds du projet
   * @param cables   Liste complète des câbles du projet
   * @param direction 'downstream' | 'upstream' | 'both' (défaut = 'both')
   */
  applyRegulationToNetwork(
    result: SRG2Result,
    nodes: Node[],
    cables: Cable[],
    direction: 'downstream' | 'upstream' | 'both' = 'both'
  ): Node[] {
    if (!result.isActive) {
      return nodes;
    }

    // -----------------------------------------------------------------
    // 1️⃣  Copie profonde (on clone uniquement les propriétés primitives)
    // -----------------------------------------------------------------
    const clonedNodes: Node[] = nodes.map(n => ({ ...n }));

    // -----------------------------------------------------------------
    // 2️⃣  Met à jour le nœud régulé
    // -----------------------------------------------------------------
    const regNode = clonedNodes.find(n => n.id === result.nodeId);
    if (!regNode) return clonedNodes; // sécurité

    regNode.tensionCible = result.regulatedVoltage;
    regNode.srg2Applied = true;
    regNode.srg2State = result.state;
    regNode.srg2Ratio = result.ratio;

    console.log(`🔧 SRG2: Updated node ${result.nodeId} voltage to ${result.regulatedVoltage.toFixed(1)}V`);

    // -----------------------------------------------------------------
    // 3️⃣  Fonction utilitaire de propagation
    // -----------------------------------------------------------------
    const propagate = (
      startIds: string[],
      allowedDirection: 'downstream' | 'upstream'
    ) => {
      const visited = new Set<string>(startIds);
      const queue = [...startIds];

      while (queue.length) {
        const curId = queue.shift()!;
        // Trouve les câbles reliés au nœud courant
        const relatedCables = cables.filter(c =>
          allowedDirection === 'downstream'
            ? c.nodeAId === curId               // on part du côté « amont » vers le descendant
            : c.nodeBId === curId               // on part du côté « aval » vers l'amont
        );

        for (const cab of relatedCables) {
          const neighbourId =
            allowedDirection === 'downstream' ? cab.nodeBId : cab.nodeAId;

          // Empêcher la double régulation du nœud cible
          if (neighbourId === result.nodeId) continue;
          
          if (visited.has(neighbourId)) continue;
          visited.add(neighbourId);
          queue.push(neighbourId);

          const neighbour = clonedNodes.find(n => n.id === neighbourId);
          if (!neighbour) continue;

          // -------------------------------------------------------------
          // Application du ratio en préservant la cohérence des tensions
          // -------------------------------------------------------------
          const baseVoltage = neighbour.tensionCible ?? result.originalVoltage;
          const newVoltage = baseVoltage * result.ratio;
          neighbour.tensionCible = newVoltage;

          // On conserve les informations de trace (facultatif)
          neighbour.srg2Applied = true;
          neighbour.srg2State = result.state;
          neighbour.srg2Ratio = result.ratio;

          console.log(`[SRG2-prop] Updating ${neighbourId}: ${baseVoltage.toFixed(1)}V → ${newVoltage.toFixed(1)}V (ratio: ${result.ratio.toFixed(3)} from ${curId})`);
        }
      }
    };

    // -----------------------------------------------------------------
    // 4️⃣  Propagation selon le paramètre `direction`
    // -----------------------------------------------------------------
    if (direction === 'downstream' || direction === 'both') {
      // Les câbles dont le nœud régulé est le **nodeA** (amont → aval)
      propagate([result.nodeId], 'downstream');
    }

    if (direction === 'upstream' || direction === 'both') {
      // Les câbles dont le nœud régulé est le **nodeB** (aval ← amont)
      propagate([result.nodeId], 'upstream');
    }

    return clonedNodes;
  }
}