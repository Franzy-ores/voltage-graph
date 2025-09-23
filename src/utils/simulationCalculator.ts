import { ElectricalCalculator } from './electricalCalculations';
import { SRG2Regulator } from './SRG2Regulator';
import { Project, CalculationScenario, CalculationResult, VoltageRegulator, NeutralCompensator, CableUpgrade, SimulationResult, SimulationEquipment, Cable, CableType, Node, SRG2Config, SRG2Result, LoadModel } from '@/types/network';

export class SimulationCalculator extends ElectricalCalculator {
  private srg2Regulator = new SRG2Regulator();

  constructor(cosPhi: number = 0.95) {
    super(cosPhi);
  }

  /**
   * Calcule avec équipements de simulation
   */
  calculateWithSimulation(
    project: Project,
    scenario: CalculationScenario,
    simulationEquipment: SimulationEquipment,
    forcedModeConfig?: any
  ): SimulationResult {
    // Constants for convergence loop
    const MAX_ITERATIONS = 10;
    const CONVERGENCE_TOLERANCE = 0.5; // volts
    
    // Réinitialiser les états SRG2 entre les simulations
    this.resetAllSrg2();
    
    // Phase 1: Initialize node voltages - clean slate for new simulation
    const initialNodes: Node[] = project.nodes.map(node => ({
      ...node,
      tensionCible: undefined,
      srg2Applied: false,
      srg2State: undefined,
      srg2Ratio: undefined
    }));
    
    let currentProjectState = {
      ...project,
      nodes: initialNodes
    };
    
    console.log('🔄 Starting iterative simulation with convergence loop...');
    console.log(`📋 Configuration: MAX_ITERATIONS=${MAX_ITERATIONS}, TOLERANCE=${CONVERGENCE_TOLERANCE}V`);
    
    // Phase 2: Convergence loop
    let hasConverged = false;
    let iterations = 0;
    let previousVoltages = new Map<string, number>();
    let finalResult: CalculationResult | undefined;
    let finalSrg2Result: SRG2Result | undefined;

    while (!hasConverged && iterations < MAX_ITERATIONS) {
      iterations++;
      console.log(`\n🔄 === SIMULATION ITERATION ${iterations}/${MAX_ITERATIONS} ===`);
      
      // Step 1: Calculate network state with current node voltages
      const calculationResult = this.calculateScenario(
        currentProjectState.nodes,
        currentProjectState.cables,
        currentProjectState.cableTypes,
        scenario,
        currentProjectState.foisonnementCharges || 100,
        currentProjectState.foisonnementProductions || 100,
        currentProjectState.transformerConfig,
        currentProjectState.loadModel || 'polyphase_equilibre',
        currentProjectState.desequilibrePourcent || 0
      );
      
      console.log(`📊 Network calculation complete - ${calculationResult.nodeMetrics?.length || 0} nodes processed`);
      
      // Store current voltages for convergence check
      const currentVoltages = new Map<string, number>();
      calculationResult.nodeMetrics?.forEach(nm => {
        currentVoltages.set(nm.nodeId, nm.V_phase_V);
      });
      
      // Step 2: Apply SRG2 regulation if enabled
      let voltageChanged = false;
      let srg2Result: SRG2Result | undefined;
      
      if (simulationEquipment.srg2?.enabled) {
        const targetNodeId = simulationEquipment.srg2.nodeId;
        const { nodes: afterSrg2Nodes, result: afterSrg2Result, srg2Result: appliedSrg2 } =
          this.applySrg2IfNeeded(
            simulationEquipment,
            currentProjectState.nodes,
            currentProjectState,
            scenario,
            calculationResult
          );
        
        // Update state with SRG2 results
        currentProjectState = {
          ...currentProjectState,
          nodes: afterSrg2Nodes as Node[]
        };
        finalResult = afterSrg2Result;
        srg2Result = appliedSrg2;
        finalSrg2Result = appliedSrg2;
        
        // Check if SRG2 actually changed voltages
        if (appliedSrg2?.isActive) {
          console.log(`✅ SRG2 applied on node ${targetNodeId}: ${appliedSrg2.originalVoltage.toFixed(1)}V → ${appliedSrg2.regulatedVoltage.toFixed(1)}V (ratio: ${appliedSrg2.ratio.toFixed(3)})`);
          voltageChanged = true;
        } else {
          console.log(`ℹ️ SRG2 configured but not active (voltage within acceptable range)`);
        }
      } else {
        // No SRG2 configured
        finalResult = calculationResult;
        console.log(`ℹ️ No SRG2 regulation configured`);
      }
      
      // Apply other equipment (neutral compensators, etc.)
      if (simulationEquipment.neutralCompensators?.length > 0) {
        const activeCompensators = simulationEquipment.neutralCompensators.filter(c => c.enabled);
        if (activeCompensators.length > 0) {
          console.log(`🔧 Applying ${activeCompensators.length} neutral compensators...`);
          finalResult = this.applyNeutralCompensation(
            currentProjectState.nodes, 
            currentProjectState.cables, 
            activeCompensators, 
            finalResult!, 
            currentProjectState.cableTypes
          );
        }
      }
      
      // Step 3: Check convergence
      if (iterations === 1) {
        // First iteration - store voltages and continue
        previousVoltages = new Map(currentVoltages);
        console.log(`📈 First iteration - storing baseline voltages for convergence check`);
      } else {
        // Check voltage differences between iterations
        let maxVoltageChange = 0;
        let maxChangeNode = '';
        
        for (const [nodeId, currentV] of currentVoltages) {
          const previousV = previousVoltages.get(nodeId) || 0;
          const change = Math.abs(currentV - previousV);
          if (change > maxVoltageChange) {
            maxVoltageChange = change;
            maxChangeNode = nodeId;
          }
        }
        
        console.log(`🎯 Convergence check: max voltage change = ${maxVoltageChange.toFixed(2)}V on node ${maxChangeNode}`);
        
        if (maxVoltageChange <= CONVERGENCE_TOLERANCE) {
          hasConverged = true;
          console.log(`✅ CONVERGED! Voltage changes below ${CONVERGENCE_TOLERANCE}V tolerance`);
        } else {
          console.log(`🔄 Not converged - continuing iteration (change: ${maxVoltageChange.toFixed(2)}V > ${CONVERGENCE_TOLERANCE}V)`);
          previousVoltages = new Map(currentVoltages);
        }
      }
      
      // Safety: if no voltage changed and no regulation was applied, converge immediately
      if (!voltageChanged && iterations > 1) {
        hasConverged = true;
        console.log(`✅ CONVERGED! No voltage regulation applied, network is stable`);
      }
    }
    
    // Phase 3: Finalize results
    if (!hasConverged) {
      console.warn(`⚠️ Did not converge after ${MAX_ITERATIONS} iterations - using last result`);
    }
    
    console.log(`\n🏁 Simulation complete: ${iterations} iterations, converged: ${hasConverged}`);
    
    // Return final simulation result
    return {
      ...finalResult!,
      isSimulation: true,
      baselineResult: finalResult!,
      equipment: simulationEquipment,
      convergenceStatus: hasConverged ? 'converged' : 'max_iterations',
      iterations,
      srg2Result: finalSrg2Result
    } as SimulationResult;
  }

  /**
   * Réinitialise tous les états SRG2 (utile entre deux runs) - Phase 4: Méthode publique
   */
  private resetAllSrg2(): void {
    this.srg2Regulator.resetAll();
    console.log('[SRG2-Reset] All SRG2 states cleared for new simulation');
  }

  /**
   * Phase 4: Détermine la tension de référence correcte pour l'initialisation des nœuds
   */
  private getInitialNodeVoltage(node: Node, project: Project): number {
    // Pour les nœuds source, utiliser la tension du transformateur
    if (node.isSource || node.id === '0') {
      return project.transformerConfig?.nominalVoltage_V ?? 230;
    }
    
    // Pour les autres nœuds, déterminer selon le système électrique
    const voltageSystem = project.voltageSystem || 'TRIPHASÉ_230V';
    
    switch (voltageSystem) {
      case 'TÉTRAPHASÉ_400V':
        return 400;
      case 'TRIPHASÉ_230V':
      default:
        return 230;
    }
  }

  /**
   * Phase 1 - Fonction utilitaire pour identifier les nœuds SRG2
   */
  private isSRG2Node(nodeId: string, simulationEquipment?: SimulationEquipment): boolean {
    return simulationEquipment?.srg2?.enabled === true && simulationEquipment.srg2.nodeId === nodeId;
  }

  /**
   * Fonction centrale pour appliquer le régulateur SRG2 - point d'entrée unique
   * Toute application du SRG2 doit passer par cette fonction pour éviter les calculs multiples
   */
  private applySrg2IfNeeded(
    simulationEquipment: SimulationEquipment,
    nodes: Node[],
    project: Project,
    scenario: CalculationScenario,
    baseResult: CalculationResult
  ): { nodes: Node[]; result: CalculationResult; srg2Result?: SRG2Result } {
    if (!simulationEquipment.srg2?.enabled) {
      return { nodes, result: baseResult };
    }

    // Check if it's an SRG2 node
    if (!simulationEquipment.srg2?.enabled) {
      return { nodes, result: baseResult };
    }

    const targetNode = nodes.find(n => n.id === simulationEquipment.srg2!.nodeId);
    if (!targetNode) {
      console.warn(`⚠️ SRG2: Node ${simulationEquipment.srg2.nodeId} not found`);
      return { nodes, result: baseResult };
    }

    // Extraction précise des tensions réelles calculées
    const nodeMetrics = baseResult.nodeMetricsPerPhase?.find(n => n.nodeId === targetNode.id);
    const simpleNodeMetrics = baseResult.nodeMetrics?.find(n => n.nodeId === targetNode.id);
    
    console.log(`🔍 [SRG2-VOLTAGE] Extracting real calculated voltages for node ${targetNode.id}:`);
    console.log(`📊 Available data:`, {
      nodeMetricsPerPhase: nodeMetrics ? {
        voltagesPerPhase: nodeMetrics.voltagesPerPhase
      } : 'NOT FOUND',
      nodeMetrics: simpleNodeMetrics ? {
        V_phase_V: simpleNodeMetrics.V_phase_V
      } : 'NOT FOUND'
    });
    
    // Extraction des tensions réelles (priorité: nodeMetricsPerPhase > nodeMetrics)
    let actualVoltages = undefined;
    
    // Priorité 1: Utiliser les bonnes tensions selon le type de réseau
    const networkType = project.voltageSystem === 'TRIPHASÉ_230V' ? '230V' : '400V';
    
    if (networkType === '230V' && nodeMetrics?.calculatedVoltagesComposed) {
      // Réseau 230V: Utiliser les tensions composées (phase-phase)
      const composedVoltages = nodeMetrics.calculatedVoltagesComposed;
      if (composedVoltages.AB > 50 && composedVoltages.BC > 50 && composedVoltages.CA > 50) {
        actualVoltages = {
          A: composedVoltages.AB,
          B: composedVoltages.BC, 
          C: composedVoltages.CA
        };
        console.log(`✅ [SRG2-VOLTAGE] 230V Network - Using phase-phase voltages: AB=${composedVoltages.AB.toFixed(1)}V, BC=${composedVoltages.BC.toFixed(1)}V, CA=${composedVoltages.CA.toFixed(1)}V`);
      }
    } else if (networkType === '400V' && nodeMetrics?.calculatedVoltagesPerPhase) {
      // Réseau 400V: Utiliser les tensions phase-neutre
      const calculatedVoltages = nodeMetrics.calculatedVoltagesPerPhase;
      if (calculatedVoltages.A > 50 && calculatedVoltages.B > 50 && calculatedVoltages.C > 50) {
        actualVoltages = {
          A: calculatedVoltages.A,
          B: calculatedVoltages.B,
          C: calculatedVoltages.C
        };
        console.log(`✅ [SRG2-VOLTAGE] 400V Network - Using phase-neutral voltages: A=${calculatedVoltages.A.toFixed(1)}V, B=${calculatedVoltages.B.toFixed(1)}V, C=${calculatedVoltages.C.toFixed(1)}V`);
      }
    }
    
    // Priorité 2: Fallback sur tensions d'affichage (avec avertissement)
    if (!actualVoltages && nodeMetrics?.voltagesPerPhase) {
      const voltages = nodeMetrics.voltagesPerPhase;
      if (voltages.A > 50 && voltages.B > 50 && voltages.C > 50) {
        actualVoltages = {
          A: voltages.A,
          B: voltages.B,
          C: voltages.C
        };
        console.warn(`⚠️ [SRG2-VOLTAGE] FALLBACK: Using display voltages (with scale): A=${voltages.A.toFixed(1)}V, B=${voltages.B.toFixed(1)}V, C=${voltages.C.toFixed(1)}V`);
      }
    }
    
    // Priorité 3: Utiliser la tension de phase calculée (équilibré)
    if (!actualVoltages && simpleNodeMetrics?.V_phase_V && simpleNodeMetrics.V_phase_V > 50) {
      const phaseVoltage = simpleNodeMetrics.V_phase_V;
      actualVoltages = {
        A: phaseVoltage,
        B: phaseVoltage,
        C: phaseVoltage
      };
      console.log(`✅ [SRG2-VOLTAGE] Using calculated balanced voltage: ${phaseVoltage.toFixed(1)}V`);
    }
    
    // ERREUR: Si aucune tension calculée n'est disponible
    if (!actualVoltages) {
      console.error(`❌ [SRG2-VOLTAGE] CRITICAL: No calculated voltages found for node ${targetNode.id}!`);
      console.error(`❌ This means SRG2 will use default tension (${targetNode.tensionCible}V) instead of real calculated voltage!`);
      console.error(`❌ Check why nodeMetricsPerPhase or nodeMetrics is missing voltage data.`);
    }
    
    console.log(`🔧 Applying SRG2 voltage regulator with actual voltages: ${actualVoltages ? `${actualVoltages.A.toFixed(1)}/${actualVoltages.B.toFixed(1)}/${actualVoltages.C.toFixed(1)}V` : 'unavailable'}`);
    const srg2Result = this.srg2Regulator.apply(
      simulationEquipment.srg2,
      targetNode,
      project,
      actualVoltages
    );

    if (!srg2Result.isActive) {
      return { nodes, result: baseResult, srg2Result };
    }

    // Propagation uniquement en aval (typique)
    const updatedNodes = this.srg2Regulator.applyRegulationToNetwork(
      srg2Result,
      nodes,
      project.cables,
      'downstream'
    );

    console.log(`🔄 [SRG2-RECALC] Starting full network recalculation after SRG2 regulation on node ${srg2Result.nodeId}...`);
    
    // Log node voltages before recalculation
    updatedNodes.forEach(n => {
      if (n.srg2Applied || n.id === srg2Result.nodeId) {
        console.log(`📊 [PRE-RECALC] Node ${n.id}: tensionCible=${n.tensionCible}V, srg2Applied=${n.srg2Applied}, srg2Ratio=${n.srg2Ratio}`);
      }
    });
    
    // Recalculer le réseau complet pour préserver les références de tension
    const newResult = this.calculateScenario(
      updatedNodes,
      project.cables,
      project.cableTypes,
      scenario,
      project.foisonnementCharges ?? 100,
      project.foisonnementProductions ?? 100,
      project.transformerConfig,
      project.loadModel ?? 'polyphase_equilibre',
      project.desequilibrePourcent ?? 0
    );
    
    // CORRECTION CRITIQUE: Propager les tensions régulées SRG2 dans le projet
    if (srg2Result.isActive) {
      // 1. Mettre à jour tensionCible du nœud régulé pour propagation
      const regulatedNode = project.nodes.find(n => n.id === srg2Result.nodeId);
      if (regulatedNode) {
        regulatedNode.tensionCible = srg2Result.regulatedVoltage;
        regulatedNode.srg2Applied = true;
        regulatedNode.srg2State = srg2Result.state;
        regulatedNode.srg2Ratio = srg2Result.ratio;
        
        console.log(`🔧 [SRG2-PROPAGATION] Set tensionCible=${srg2Result.regulatedVoltage.toFixed(1)}V for node ${srg2Result.nodeId}`);
      }
      
      // 2. Forcer les tensions régulées dans les résultats d'affichage
      if (srg2Result.regulatedVoltages && newResult.nodeMetricsPerPhase) {
        const srg2NodeMetrics = newResult.nodeMetricsPerPhase.find(n => n.nodeId === srg2Result.nodeId);
        if (srg2NodeMetrics) {
          // Forcer les bonnes tensions régulées dans les résultats d'affichage
          srg2NodeMetrics.voltagesPerPhase = {
            A: srg2Result.regulatedVoltages.A,
            B: srg2Result.regulatedVoltages.B,
            C: srg2Result.regulatedVoltages.C
          };
          
          // CRITIQUE: Forcer aussi les tensions calculées pour les calculs aval
          if (srg2NodeMetrics.calculatedVoltagesPerPhase) {
            srg2NodeMetrics.calculatedVoltagesPerPhase = {
              A: srg2Result.regulatedVoltages.A,
              B: srg2Result.regulatedVoltages.B,
              C: srg2Result.regulatedVoltages.C
            };
          }
          
          console.log(`🔧 [SRG2-FIX] Forced regulated voltages in calculation results:`, {
            nodeId: srg2Result.nodeId,
            regulated: `A=${srg2Result.regulatedVoltages.A.toFixed(1)}V, B=${srg2Result.regulatedVoltages.B.toFixed(1)}V, C=${srg2Result.regulatedVoltages.C.toFixed(1)}V`
          });
        }
      }
    }
    
    // Log final results
    if (newResult.nodeMetricsPerPhase) {
      const srg2NodeMetrics = newResult.nodeMetricsPerPhase.find(n => n.nodeId === srg2Result.nodeId);
      if (srg2NodeMetrics?.voltagesPerPhase) {
        console.log(`✅ [SRG2-FINAL] Node ${srg2Result.nodeId} final voltages:`, srg2NodeMetrics.voltagesPerPhase);
      }
    }

    return { nodes: updatedNodes, result: newResult, srg2Result };
  }


  /**
   * Applique les équipements de simulation
   */
  private calculateScenarioWithEquipment(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    simulationEquipment: SimulationEquipment,
    baseResult: CalculationResult,
    project: Project,
    scenario: CalculationScenario
  ): CalculationResult {
    let result = { ...baseResult };
    let modifiedNodes = [...nodes];

    // Phase 2 - Validation avant application (détection de conflits)
    // Note: Plus de conflits possibles car il n'y a plus que SRG2
    if (simulationEquipment.srg2?.enabled) {
      const srg2NodeId = simulationEquipment.srg2.nodeId;
      console.log(`✅ [SRG2-INFO] SRG2 regulator configured on node ${srg2NodeId}`);
    }

    console.log(`[ORDER-TRACE] Starting equipment application in priority order: SRG2 → Compensators → Classical regulators`);

    // Application du régulateur SRG2 (PRIORITÉ 1 - via fonction centralisée)
    const { nodes: afterSrg2Nodes, result: afterSrg2Result, srg2Result } =
      this.applySrg2IfNeeded(
        simulationEquipment,
        modifiedNodes,
        project,
        scenario,
        baseResult
      );

    result = afterSrg2Result;
    modifiedNodes = afterSrg2Nodes;

    if (srg2Result) {
      (result as any).srg2Result = srg2Result;
      console.log(`✅ [ORDER-TRACE] SRG2 applied successfully - node ${srg2Result.nodeId} regulated with ratio ${srg2Result.ratio.toFixed(3)}`);
    } else {
      console.log(`ℹ️ [ORDER-TRACE] No SRG2 regulation applied`);
    }

    // Application des compensateurs de neutre (ÉQUI8)
    if (simulationEquipment.neutralCompensators && simulationEquipment.neutralCompensators.length > 0) {
      const activeCompensators = simulationEquipment.neutralCompensators.filter(c => c.enabled);
      if (activeCompensators.length > 0) {
        console.log(`🔧 Applying ${activeCompensators.length} neutral compensators...`);
        result = this.applyNeutralCompensation(modifiedNodes, cables, activeCompensators, result, cableTypes);
      }
    }

    // Application SRG2 seulement (plus de régulateurs classiques)
    if (simulationEquipment.srg2?.enabled) {
      console.log(`🔧 [SRG2] Applying SRG2 regulator...`);
    }

    // SRG2 result déjà stocké dans le bloc précédent

    return result;
  }

  /**
   * Crée un régulateur par défaut pour un nœud
   */
  createDefaultRegulator(nodeId: string, sourceVoltage: number): VoltageRegulator {
    const regulatorType = sourceVoltage > 300 ? '400V_44kVA' : '230V_77kVA';
    const maxPower = sourceVoltage > 300 ? 44 : 77;
    
    return {
      id: `regulator_${nodeId}_${Date.now()}`,
      nodeId,
      type: regulatorType as any,
      targetVoltage_V: 230,
      maxPower_kVA: maxPower,
      enabled: false
    };
  }

  /**
   * Crée une configuration SRG2 par défaut pour un nœud
   */
  createDefaultSRG2Config(nodeId: string): SRG2Config {
    return {
      nodeId,
      enabled: false
    };
  }

  /**
   * Propose des améliorations de câbles basées sur la chute de tension
   */
  proposeFullCircuitReinforcement(
    cables: Cable[],
    availableCableTypes: CableType[],
    voltageDropThreshold: number = 8.0
  ): CableUpgrade[] {
    const upgrades: CableUpgrade[] = [];
    
    for (const cable of cables) {
      const currentVoltageDropPercent = Math.abs((cable as any).deltaU_percent || 0);
      
      if (currentVoltageDropPercent > voltageDropThreshold) {
        const currentType = availableCableTypes.find(ct => ct.id === cable.typeId);
        if (!currentType) continue;

        // Chercher un câble de section supérieure
        const betterTypes = availableCableTypes
          .filter(ct => 
            ct.matiere === currentType.matiere &&
            ct.posesPermises.some(pose => currentType.posesPermises.includes(pose)) &&
            ct.R12_ohm_per_km < currentType.R12_ohm_per_km
          )
          .sort((a, b) => a.R12_ohm_per_km - b.R12_ohm_per_km);

        if (betterTypes.length > 0) {
          const recommendedType = betterTypes[0];
          const improvementPercent = ((currentType.R12_ohm_per_km - recommendedType.R12_ohm_per_km) / currentType.R12_ohm_per_km) * 100;

          upgrades.push({
            originalCableId: cable.id,
            newCableTypeId: recommendedType.id,
            reason: "voltage_drop" as const,
            before: {
              voltageDropPercent: currentVoltageDropPercent,
              current_A: 0, // À calculer si nécessaire
              losses_kW: 0
            },
            after: {
              voltageDropPercent: currentVoltageDropPercent * (recommendedType.R12_ohm_per_km / currentType.R12_ohm_per_km),
              current_A: 0,
              losses_kW: 0
            },
            improvement: {
              voltageDropReduction: improvementPercent,
              lossReduction_kW: 0,
              lossReductionPercent: improvementPercent
            }
          });
        }
      }
    }

    return upgrades;
  }

  /**
   * Méthode pour le mode forcé - version simplifiée pour la compatibilité
   */
  runForcedModeConvergence(
    project: Project,
    scenario: CalculationScenario,
    targetVoltages: Record<string, number>
  ): any {
    console.log('🔧 Running forced mode convergence (simplified)');
    
    // Pour l'instant, retourner un calcul standard
    const result = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      scenario,
      project.foisonnementCharges || 100,
      project.foisonnementProductions || 100,
      project.transformerConfig,
      project.loadModel || 'polyphase_equilibre',
      project.desequilibrePourcent || 0
    );
    
    return {
      ...result,
      converged: true,
      forcedMode: true
    };
  }
}