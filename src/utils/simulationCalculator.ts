import { ElectricalCalculator } from './electricalCalculations';
import { SRG2Regulator } from './SRG2Regulator';
import { Project, CalculationScenario, CalculationResult, VoltageRegulator, NeutralCompensator, CableUpgrade, SimulationResult, SimulationEquipment, Cable, CableType, Node, SRG2Config, SRG2Result, LoadModel } from '@/types/network';

export class SimulationCalculator extends ElectricalCalculator {
  private srg2Regulator = new SRG2Regulator();

  constructor(cosPhi: number = 0.95) {
    super(cosPhi);
  }

  /**
   * NOUVEAU FLUX SRG2: Calcul séparé des équipements pour préserver les tensions primaires
   */
  calculateWithSimulation(
    project: Project,
    scenario: CalculationScenario,
    simulationEquipment: SimulationEquipment,
    forcedModeConfig?: any
  ): SimulationResult {
    const MAX_ITERATIONS = 10;
    const CONVERGENCE_TOLERANCE = 0.5;
    
    this.resetAllSrg2();
    
    console.log('🔄 Starting NEW SRG2 FLOW simulation...');
    
    // ÉTAPE 1: Nœuds ordinaires sans équipements
    const cleanNodes: Node[] = project.nodes.map(node => ({
      ...node,
      clients: node.clients ? [...node.clients] : [],
      productions: node.productions ? [...node.productions] : [],
      tensionCible: undefined,
      srg2Applied: false,
      srg2State: undefined,
      srg2Ratio: undefined
    }));
    
    let currentProjectState = { ...project, nodes: cleanNodes };
    let originalVoltages = new Map<string, { A: number; B: number; C: number; balanced: number }>();
    
    let hasConverged = false;
    let iterations = 0;
    let previousVoltages = new Map<string, number>();
    let finalResult: CalculationResult | undefined;
    let finalSrg2Result: SRG2Result | undefined;

    while (!hasConverged && iterations < MAX_ITERATIONS) {
      iterations++;
      console.log(`\n🔄 === NEW SRG2 FLOW - ITERATION ${iterations}/${MAX_ITERATIONS} ===`);
      
      // ÉTAPE 1: Calcul électrique complet SANS équipements
      const baseCalculationResult = this.calculateScenario(
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
      
      console.log(`✅ Base calculation complete - ${baseCalculationResult.nodeMetrics?.length || 0} nodes processed`);
      
      // ÉTAPE 2: Préservation des tensions originales (première itération)
      if (iterations === 1) {
        console.log(`📋 Step 2: Preserving original calculated voltages`);
        originalVoltages.clear();
        
        baseCalculationResult.nodeMetricsPerPhase?.forEach(nodeMetrics => {
          if (nodeMetrics.calculatedVoltagesPerPhase) {
            originalVoltages.set(nodeMetrics.nodeId, {
              A: nodeMetrics.calculatedVoltagesPerPhase.A,
              B: nodeMetrics.calculatedVoltagesPerPhase.B,
              C: nodeMetrics.calculatedVoltagesPerPhase.C,
              balanced: (nodeMetrics.calculatedVoltagesPerPhase.A + nodeMetrics.calculatedVoltagesPerPhase.B + nodeMetrics.calculatedVoltagesPerPhase.C) / 3
            });
          }
        });
        
        console.log(`✅ Original voltages preserved for ${originalVoltages.size} nodes`);
      }
      
      const currentVoltages = new Map<string, number>();
      baseCalculationResult.nodeMetrics?.forEach(nm => {
        currentVoltages.set(nm.nodeId, nm.V_phase_V);
      });
      
      // ÉTAPE 3: Application SRG2 basée sur tensions originales
      let voltageChanged = false;
      
      if (simulationEquipment.srg2?.enabled) {
        console.log(`🔧 Step 3: Applying SRG2 regulation based on original voltages`);
        const { nodes: afterSrg2Nodes, result: afterSrg2Result, srg2Result: appliedSrg2 } =
          this.applySrg2WithOriginalVoltages(
            simulationEquipment,
            currentProjectState.nodes,
            currentProjectState,
            scenario,
            baseCalculationResult,
            originalVoltages
          );
        
        currentProjectState = { ...currentProjectState, nodes: afterSrg2Nodes as Node[] };
        finalResult = afterSrg2Result;
        finalSrg2Result = appliedSrg2;
        
        if (appliedSrg2?.isActive) {
          console.log(`✅ SRG2 applied: ${appliedSrg2.originalVoltage.toFixed(1)}V → ${appliedSrg2.regulatedVoltage.toFixed(1)}V`);
          voltageChanged = true;
        }
      } else {
        finalResult = baseCalculationResult;
      }
      
      // Vérification de convergence
      if (iterations === 1) {
        previousVoltages = new Map(currentVoltages);
      } else {
        let maxVoltageChange = 0;
        for (const [nodeId, currentV] of currentVoltages) {
          const previousV = previousVoltages.get(nodeId) || 0;
          const change = Math.abs(currentV - previousV);
          if (change > maxVoltageChange) {
            maxVoltageChange = change;
          }
        }
        
        if (maxVoltageChange <= CONVERGENCE_TOLERANCE) {
          hasConverged = true;
          console.log(`✅ CONVERGED! Voltage change: ${maxVoltageChange.toFixed(2)}V`);
        } else {
          previousVoltages = new Map(currentVoltages);
        }
      }
      
      if (!voltageChanged && iterations > 1) {
        hasConverged = true;
        console.log(`✅ CONVERGED! No voltage regulation applied`);
      }
    }
    
    if (!hasConverged) {
      console.warn(`⚠️ Did not converge after ${MAX_ITERATIONS} iterations`);
    }
    
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
   * NOUVEAU: Applique SRG2 en utilisant les tensions originales préservées
   */
  private applySrg2WithOriginalVoltages(
    simulationEquipment: SimulationEquipment,
    nodes: Node[],
    project: Project,
    scenario: CalculationScenario,
    baseResult: CalculationResult,
    originalVoltages: Map<string, { A: number; B: number; C: number; balanced: number }>
  ): { nodes: Node[]; result: CalculationResult; srg2Result?: SRG2Result } {
    
    if (!simulationEquipment.srg2?.enabled) {
      return { nodes, result: baseResult };
    }

    const targetNode = nodes.find(n => n.id === simulationEquipment.srg2!.nodeId);
    if (!targetNode) {
      return { nodes, result: baseResult };
    }

    const originalNodeVoltages = originalVoltages.get(targetNode.id);
    if (!originalNodeVoltages) {
      console.error(`❌ [NEW SRG2 FLOW] No original voltages for node ${targetNode.id}`);
      
      const inactiveSrg2Result: SRG2Result = {
        nodeId: targetNode.id,
        originalVoltage: 230,
        regulatedVoltage: 230,
        state: 'OFF',
        ratio: 1.0,
        powerDownstream_kVA: 0,
        diversifiedLoad_kVA: 0,
        diversifiedProduction_kVA: 0,
        netPower_kVA: 0,
        networkType: project.voltageSystem === 'TRIPHASÉ_230V' ? '230V' : '400V',
        isActive: false,
        errorMessage: 'Données de tension manquantes - Le nœud n\'est pas inclus dans les calculs électriques.'
      };
      
      return { nodes, result: baseResult, srg2Result: inactiveSrg2Result };
    }
    
    const actualVoltages = {
      A: originalNodeVoltages.A,
      B: originalNodeVoltages.B,
      C: originalNodeVoltages.C
    };
    
    console.log(`✅ [NEW SRG2 FLOW] Using original voltages: A=${actualVoltages.A.toFixed(1)}V, B=${actualVoltages.B.toFixed(1)}V, C=${actualVoltages.C.toFixed(1)}V`);
    
    try {
      const srg2Result = this.srg2Regulator.apply(
        simulationEquipment.srg2,
        targetNode,
        project,
        actualVoltages,
        Date.now()
      );

      const updatedNodes = nodes.map(node => {
        if (node.id === targetNode.id) {
          return {
            ...node,
            tensionCible: srg2Result.isActive ? srg2Result.regulatedVoltage : undefined,
            srg2Applied: srg2Result.isActive,
            srg2State: srg2Result.state,
            srg2Ratio: srg2Result.ratio
          };
        }
        return node;
      });
      
      let updatedResult = baseResult;
      
      if (srg2Result.isActive) {
        console.log(`🔄 [NEW SRG2 FLOW] Recalculating downstream network...`);
        try {
          updatedResult = this.calculateScenario(
            updatedNodes,
            project.cables,
            project.cableTypes,
            scenario,
            project.foisonnementCharges || 100,
            project.foisonnementProductions || 100,
            project.transformerConfig,
            project.loadModel || 'polyphase_equilibre',
            project.desequilibrePourcent || 0
          );
        } catch (error) {
          console.error(`❌ Error during recalculation:`, error);
          updatedResult = baseResult;
        }
      }

      return {
        nodes: updatedNodes,
        result: updatedResult,
        srg2Result
      };
      
    } catch (error) {
      console.error(`❌ Error applying SRG2:`, error);
      
      const errorSrg2Result: SRG2Result = {
        nodeId: targetNode.id,
        originalVoltage: originalNodeVoltages.balanced,
        regulatedVoltage: originalNodeVoltages.balanced,
        state: 'OFF',
        ratio: 1.0,
        powerDownstream_kVA: 0,
        diversifiedLoad_kVA: 0,
        diversifiedProduction_kVA: 0,
        netPower_kVA: 0,
        networkType: project.voltageSystem === 'TRIPHASÉ_230V' ? '230V' : '400V',
        isActive: false,
        errorMessage: `Erreur SRG2: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
      };
      
      return { nodes, result: baseResult, srg2Result: errorSrg2Result };
    }
  }

  private resetAllSrg2(): void {
    this.srg2Regulator.resetAll();
    console.log('[SRG2-Reset] All SRG2 states cleared');
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

  /**
   * NOUVEAU: Applique SRG2 en utilisant les tensions originales calculées
   * Cette méthode garantit que les décisions SRG2 sont basées sur les tensions "primaires"
   * avant toute correction, conformément au nouveau flux.
   */
  private applySrg2WithOriginalVoltages(
    simulationEquipment: SimulationEquipment,
    nodes: Node[],
    project: Project,
    scenario: CalculationScenario,
    baseResult: CalculationResult,
    originalVoltages: Map<string, { A: number; B: number; C: number; balanced: number }>
  ): { nodes: Node[]; result: CalculationResult; srg2Result?: SRG2Result } {
    if (!simulationEquipment.srg2?.enabled) {
      console.log(`⚠️ NEW SRG2 FLOW: Not enabled, returning base result without SRG2`);
      return { nodes, result: baseResult };
    }

    const targetNode = nodes.find(n => n.id === simulationEquipment.srg2!.nodeId);
    if (!targetNode) {
      console.warn(`⚠️ NEW SRG2 FLOW: Node ${simulationEquipment.srg2.nodeId} not found`);
      return { nodes, result: baseResult };
    }

    console.log(`🔍 [NEW SRG2 FLOW] Processing SRG2 for node ${targetNode.id}`);
    console.log(`  - Original voltages available: ${originalVoltages.has(targetNode.id)}`);
    console.log(`  - Base calculation found node: ${!!baseResult.nodeMetricsPerPhase?.find(n => n.nodeId === targetNode.id)}`);
    
    // ÉTAPE 2 CRITIQUE: Utiliser les tensions originales préservées
    const originalNodeVoltages = originalVoltages.get(targetNode.id);
    if (!originalNodeVoltages) {
      console.error(`❌ [NEW SRG2 FLOW] CRITICAL: No original voltages found for node ${targetNode.id}!`);
      console.error(`   - This means the node was not found in the base electrical calculation`);
      console.error(`   - Available original voltage nodes: [${Array.from(originalVoltages.keys()).join(', ')}]`);
      console.error(`   - This indicates the node connectivity issue persists`);
      
      // Return inactive SRG2 result
      const fallbackVoltage = project.transformerConfig?.nominalVoltage_V || 230;
      const inactiveSrg2Result: SRG2Result = {
        nodeId: targetNode.id,
        originalVoltage: fallbackVoltage,
        regulatedVoltage: fallbackVoltage,
        state: 'OFF',
        ratio: 1.0,
        powerDownstream_kVA: 0,
        diversifiedLoad_kVA: 0,
        diversifiedProduction_kVA: 0,
        netPower_kVA: 0,
        networkType: project.voltageSystem === 'TRIPHASÉ_230V' ? '230V' : '400V',
        isActive: false,
        errorMessage: 'Node not found in electrical calculations - connectivity issue'
      };
      
      return { 
        nodes, 
        result: baseResult,
        srg2Result: inactiveSrg2Result
      };
    }
    
    console.log(`✅ [NEW SRG2 FLOW] Using preserved original voltages for SRG2 decision:`);
    console.log(`   A=${originalNodeVoltages.A.toFixed(1)}V, B=${originalNodeVoltages.B.toFixed(1)}V, C=${originalNodeVoltages.C.toFixed(1)}V`);
    console.log(`   Average=${originalNodeVoltages.balanced.toFixed(1)}V`);
    
    // Extraction des tensions calculées actuelles (pour comparaison)
    const nodeMetrics = baseResult.nodeMetricsPerPhase?.find(n => n.nodeId === targetNode.id);
    const simpleNodeMetrics = baseResult.nodeMetrics?.find(n => n.nodeId === targetNode.id);
    // ÉTAPE 3: Préparer les tensions pour SRG2 (utiliser les tensions originales préservées)
    const networkType = project.voltageSystem === 'TRIPHASÉ_230V' ? '230V' : '400V';
    
    // Utiliser les tensions originales pour la décision SRG2
    const actualVoltages = {
      A: originalNodeVoltages.A,
      B: originalNodeVoltages.B,
      C: originalNodeVoltages.C
    };
    
    console.log(`✅ [NEW SRG2 FLOW] Using ORIGINAL voltages for SRG2 regulation decision:`);
    console.log(`   Network type: ${networkType}`);
    console.log(`   Original voltages: A=${actualVoltages.A.toFixed(1)}V, B=${actualVoltages.B.toFixed(1)}V, C=${actualVoltages.C.toFixed(1)}V`);
    
    // Note: Les tensions actuelles sont uniquement pour information/comparaison
    if (nodeMetrics?.calculatedVoltagesPerPhase) {
      const currentVoltages = nodeMetrics.calculatedVoltagesPerPhase;
      console.log(`   Current voltages: A=${currentVoltages.A.toFixed(1)}V, B=${currentVoltages.B.toFixed(1)}V, C=${currentVoltages.C.toFixed(1)}V`);
      const voltageDiff = Math.abs(originalNodeVoltages.balanced - (currentVoltages.A + currentVoltages.B + currentVoltages.C) / 3);
      if (voltageDiff > 1.0) {
        console.log(`   ⚠️ Voltage difference detected: ${voltageDiff.toFixed(1)}V (original vs current)`);
      }
    }
    
    // Si les tensions originales ne sont pas valides, traiter comme une erreur
    if (actualVoltages.A < 50 || actualVoltages.B < 50 || actualVoltages.C < 50) {
      console.error(`❌ [NEW SRG2 FLOW] CRITICAL: Invalid original voltages for node ${targetNode.id}!`);
      console.error(`   Original voltages: A=${actualVoltages.A.toFixed(1)}V, B=${actualVoltages.B.toFixed(1)}V, C=${actualVoltages.C.toFixed(1)}V`);
      console.error(`❌ This indicates an issue in the base electrical calculation`);

      // Créer un SRG2Result inactif avec message d'erreur explicite
      const fallbackVoltage = project.transformerConfig?.nominalVoltage_V || 230;
      const inactiveSrg2Result: SRG2Result = {
        nodeId: targetNode.id,
        originalVoltage: fallbackVoltage,
        regulatedVoltage: fallbackVoltage,
        state: 'OFF',
        ratio: 1.0,
        powerDownstream_kVA: 0,
        diversifiedLoad_kVA: 0,
        diversifiedProduction_kVA: 0,
        netPower_kVA: 0,
        networkType: networkType,
        isActive: false,
        errorMessage: `Données de tension manquantes - Le nœud ${targetNode.id} n'est pas inclus dans les calculs électriques. Vérifiez que le nœud est bien connecté au réseau et relancez la simulation.`
      };
      
      return { nodes, result: baseResult, srg2Result: inactiveSrg2Result };
    }
    // ÉTAPE 4: Application SRG2 basée sur les tensions originales
    console.log(`🔧 [NEW SRG2 FLOW] Applying SRG2 regulator based on ORIGINAL voltages...`);
    console.log(`   Decision voltage (average): ${originalNodeVoltages.balanced.toFixed(1)}V`);
    
    try {
      const srg2Result = this.srg2Regulator.apply(
        simulationEquipment.srg2,
        targetNode,
        project,
        actualVoltages,
        Date.now()
      );

      console.log(`📊 [NEW SRG2 FLOW] SRG2 regulation result:`, {
        nodeId: srg2Result.nodeId,
        originalVoltage: srg2Result.originalVoltage.toFixed(1),
        regulatedVoltage: srg2Result.regulatedVoltage.toFixed(1),
        state: srg2Result.state,
        ratio: srg2Result.ratio.toFixed(3),
        isActive: srg2Result.isActive,
        powerDownstream_kVA: srg2Result.powerDownstream_kVA.toFixed(1),
        limitReason: srg2Result.limitReason || 'none'
      });

      // ÉTAPE 5: Mise à jour des nœuds avec SRG2
      const updatedNodes = nodes.map(node => {
        if (node.id === targetNode.id) {
          return {
            ...node,
            tensionCible: srg2Result.isActive ? srg2Result.regulatedVoltage : undefined,
            srg2Applied: srg2Result.isActive,
            srg2State: srg2Result.state,
            srg2Ratio: srg2Result.ratio
          };
        }
        return node;
      });
      
      // ÉTAPE 6: Recalcul aval si SRG2 actif (nouvelles tensions comme base)
      let updatedResult = baseResult;
      
      if (srg2Result.isActive) {
        console.log(`🔄 [NEW SRG2 FLOW] SRG2 active - recalculating downstream network...`);
        console.log(`   New voltage base: ${srg2Result.regulatedVoltage.toFixed(1)}V (ratio: ${srg2Result.ratio.toFixed(3)})`);
        
        try {
          updatedResult = this.calculateScenario(
            updatedNodes,
            project.cables,
            project.cableTypes,
            scenario,
            project.foisonnementCharges || 100,
            project.foisonnementProductions || 100,
            project.transformerConfig,
            project.loadModel || 'polyphase_equilibre',
            project.desequilibrePourcent || 0
          );
          console.log(`✅ [NEW SRG2 FLOW] Downstream recalculation complete`);
        } catch (error) {
          console.error(`❌ [NEW SRG2 FLOW] Error during downstream recalculation:`, error);
          updatedResult = baseResult; // Fallback to base result
        }
      } else {
        console.log(`ℹ️ [NEW SRG2 FLOW] SRG2 not active - no downstream recalculation needed`);
      }

      return {
        nodes: updatedNodes,
        result: updatedResult,
        srg2Result
      };
      
    } catch (error) {
      console.error(`❌ [NEW SRG2 FLOW] Error applying SRG2 regulator:`, error);
      
      // Return error state
      const errorSrg2Result: SRG2Result = {
        nodeId: targetNode.id,
        originalVoltage: originalNodeVoltages.balanced,
        regulatedVoltage: originalNodeVoltages.balanced,
        state: 'OFF',
        ratio: 1.0,
        powerDownstream_kVA: 0,
        diversifiedLoad_kVA: 0,
        diversifiedProduction_kVA: 0,
        netPower_kVA: 0,
        networkType,
        isActive: false,
        errorMessage: `SRG2 application error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
      
      return {
        nodes,
        result: baseResult,
        srg2Result: errorSrg2Result
      };
    }
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
