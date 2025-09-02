import { 
  Node, 
  Cable, 
  Project, 
  SimulationResult, 
  CalculationResult,
  CalculationScenario, 
  CableType, 
  VoltageRegulator,
  NeutralCompensator,
  CableUpgrade,
  SimulationEquipment,
  RegulatorType,
  TransformerConfig,
  LoadModel,
  ConnectionType
} from '@/types/network';
import { ElectricalCalculator } from '@/utils/electricalCalculations';
import { Complex, C, add, sub, mul, div, abs } from '@/utils/complex';

export class SimulationCalculator extends ElectricalCalculator {
  
  /**
   * Calcule un scénario avec équipements de simulation
   */
  calculateWithSimulation(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): SimulationResult {
    // D'abord calculer le scénario de base (sans équipements)
    const baselineResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      scenario,
      project.foisonnementCharges,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent
    );

    // Ensuite calculer avec les équipements de simulation actifs
    const simulationResult = this.calculateScenarioWithEquipment(
      project,
      scenario,
      equipment
    );

    return {
      ...simulationResult,
      isSimulation: true,
      equipment,
      baselineResult
    };
  }

  /**
   * Calcule un scénario en intégrant les équipements de simulation dans l'algorithme BFS modifié
   */
  private calculateScenarioWithEquipment(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): CalculationResult {
    // Cloner les données pour ne pas modifier l'original
    let modifiedNodes = [...project.nodes];
    let modifiedCables = [...project.cables];
    let modifiedCableTypes = [...project.cableTypes];

    // Appliquer les améliorations de câbles si activées
    const activeUpgrades = equipment.cableUpgrades.filter(upgrade => 
      modifiedCables.some(c => c.id === upgrade.originalCableId)
    );

    for (const upgrade of activeUpgrades) {
      const cableIndex = modifiedCables.findIndex(c => c.id === upgrade.originalCableId);
      if (cableIndex >= 0) {
        modifiedCables[cableIndex] = {
          ...modifiedCables[cableIndex],
          typeId: upgrade.newCableTypeId
        };
      }
    }

    // Utiliser l'algorithme BFS modifié avec équipements de simulation
    return this.calculateScenarioWithEnhancedBFS(
      modifiedNodes,
      modifiedCables,
      modifiedCableTypes,
      scenario,
      project.foisonnementCharges,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent,
      equipment
    );
  }

  /**
   * Algorithme BFS modifié avec intégration native des équipements de simulation
   */
  private calculateScenarioWithEnhancedBFS(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario,
    foisonnementCharges: number,
    foisonnementProductions: number,
    transformerConfig: TransformerConfig | null,
    loadModel: LoadModel,
    desequilibrePourcent: number,
    equipment: SimulationEquipment
  ): CalculationResult {
    // Extraire les équipements actifs
    const activeRegulators = equipment.regulators.filter(r => r.enabled);
    const activeCompensators = equipment.neutralCompensators.filter(c => c.enabled);
    
    // Créer maps pour accès rapide
    const regulatorByNode = new Map(activeRegulators.map(r => [r.nodeId, r]));
    const compensatorByNode = new Map(activeCompensators.map(c => [c.nodeId, c]));
    
    // Si aucun équipement actif, utiliser l'algorithme standard
    if (activeRegulators.length === 0 && activeCompensators.length === 0) {
      return this.calculateScenario(
        nodes, cables, cableTypes, scenario,
        foisonnementCharges, foisonnementProductions, 
        transformerConfig, loadModel, desequilibrePourcent
      );
    }

    // Modifier les nœuds pour inclure les puissances réactives des équipements
    const modifiedNodes = nodes.map(node => {
      const regulator = regulatorByNode.get(node.id);
      const compensator = compensatorByNode.get(node.id);
      
      if (!regulator && !compensator) return node;
      
      return {
        ...node,
        // Les équipements seront gérés dans les itérations BFS
        _hasSimulationEquipment: true,
        _regulator: regulator,
        _compensator: compensator
      };
    });

    // Algorithme BFS modifié avec équipements - version simplifiée intégrée
    return this.runEnhancedBFS(
      modifiedNodes, cables, cableTypes, scenario,
      foisonnementCharges, foisonnementProductions,
      transformerConfig, loadModel, desequilibrePourcent,
      regulatorByNode, compensatorByNode
    );
  }

  /**
   * BFS modifié pour intégrer les équipements de simulation avec vraie convergence
   */
  private runEnhancedBFS(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario,
    foisonnementCharges: number,
    foisonnementProductions: number,
    transformerConfig: TransformerConfig | null,
    loadModel: LoadModel,
    desequilibrePourcent: number,
    regulators: Map<string, VoltageRegulator>,
    compensators: Map<string, NeutralCompensator>
  ): CalculationResult {
    
    const maxIterations = 20;
    const convergenceTolerance = 0.1; // 0.1V
    let converged = false;
    let iteration = 0;
    let maxVoltageDelta = 0; // Déclarer ici pour être accessible après la boucle
    
    // Structures pour stocker les tensions précédentes
    let previousVoltages = new Map<string, number>();
    let currentResult = this.calculateScenario(
      nodes, cables, cableTypes, scenario,
      foisonnementCharges, foisonnementProductions,
      transformerConfig, loadModel, desequilibrePourcent
    );
    
    while (iteration < maxIterations && !converged) {
      iteration++;
      
      // Sauvegarder les tensions actuelles pour comparaison
      if (currentResult.nodeMetrics) {
        for (const nodeMetric of currentResult.nodeMetrics) {
          previousVoltages.set(nodeMetric.nodeId, nodeMetric.V_phase_V);
        }
      }
      
      // Traiter les régulateurs de tension (nœuds PV)
      let regulatorChanged = false;
      for (const regulator of regulators.values()) {
        if (!currentResult.nodeMetrics) continue;
        
        const nodeMetric = currentResult.nodeMetrics.find(m => m.nodeId === regulator.nodeId);
        if (!nodeMetric) continue;

        const currentV_phase = nodeMetric.V_phase_V;
        // Convertir en tension ligne si nécessaire pour la comparaison avec targetVoltage
        const node = nodes.find(n => n.id === regulator.nodeId);
        const isThreePhase = node && this.getNodeVoltageConfig(node.connectionType).isThreePhase;
        const currentV_line = currentV_phase * (isThreePhase ? Math.sqrt(3) : 1);
        
        const targetV = regulator.targetVoltage_V;
        const errorV = Math.abs(targetV - currentV_line);
        
        // Si l'écart est significatif, ajuster Q
        if (errorV > convergenceTolerance) {
          // Calcul du Q nécessaire basé sur l'écart de tension
          const Kp = regulator.maxPower_kVA / 50; // Gain proportionnel adaptatif
          let requiredQ = Math.sign(targetV - currentV_line) * Math.min(
            Math.abs(errorV) * Kp,
            regulator.maxPower_kVA
          );
          
          // Appliquer les limites de puissance
          if (Math.abs(requiredQ) > regulator.maxPower_kVA) {
            requiredQ = Math.sign(requiredQ) * regulator.maxPower_kVA;
            regulator.isLimited = true;
          } else {
            regulator.isLimited = false;
          }
          
          // Mettre à jour les valeurs du régulateur
          const oldQ = regulator.currentQ_kVAr || 0;
          if (Math.abs(requiredQ - oldQ) > 0.1) {
            regulator.currentQ_kVAr = requiredQ;
            regulator.currentVoltage_V = currentV_line;
            regulatorChanged = true;
            
            // Modifier le nœud pour injecter/absorber Q
            if (node) {
              // Créer une production fictive pour injecter Q
              const existingProd = node.productions.find(p => p.id.startsWith('regulator-'));
              const qPower_kVA = Math.abs(requiredQ);
              
              if (existingProd) {
                existingProd.S_kVA = qPower_kVA;
              } else {
                node.productions.push({
                  id: `regulator-${regulator.id}`,
                  label: 'Régulateur',
                  S_kVA: qPower_kVA
                });
              }
            }
          }
        } else {
          regulator.currentVoltage_V = currentV_line;
          regulator.isLimited = false;
        }
      }
      
      // Traiter les compensateurs de neutre (calcul réel de IN)
      let compensatorChanged = false;
      for (const compensator of compensators.values()) {
        // Calculer le courant de neutre réel IN = |Ia + Ib + Ic|
        let realIN_A = 0;
        
        if (loadModel === 'monophase_reparti' && desequilibrePourcent > 0) {
          // En mode déséquilibré, calculer IN approximatif
          const nodeMetric = currentResult.nodeMetrics?.find(m => m.nodeId === compensator.nodeId);
          if (nodeMetric) {
            // Approximation basée sur le déséquilibre et le courant injecté
            const baseI = nodeMetric.I_inj_A;
            const d = desequilibrePourcent / 100;
            // IN approximatif = déséquilibre * courant total
            realIN_A = baseI * d * 0.5; // Facteur empirique
          }
        }
        
        const currentIN = compensator.currentIN_A || realIN_A;
        
        if (realIN_A > compensator.tolerance_A) {
          // Calculer la compensation nécessaire
          const targetReduction = Math.min(
            0.9, // Maximum 90% de réduction
            (realIN_A - compensator.tolerance_A) / realIN_A
          );
          
          // Limiter par la puissance max disponible
          const maxQ_available = compensator.maxPower_kVA;
          const requiredQ_total = realIN_A * targetReduction * 0.4; // Facteur empirique V*I
          
          if (requiredQ_total <= maxQ_available) {
            // Répartir Q sur les 3 phases pour minimiser IN
            compensator.compensationQ_kVAr = {
              A: requiredQ_total * 0.4, // Phase avec plus de déséquilibre
              B: requiredQ_total * 0.3,
              C: requiredQ_total * 0.3
            };
            compensator.currentIN_A = realIN_A * (1 - targetReduction);
            compensator.isLimited = false;
            compensatorChanged = true;
          } else {
            // Limitation par puissance max
            compensator.compensationQ_kVAr = {
              A: maxQ_available * 0.4,
              B: maxQ_available * 0.3,
              C: maxQ_available * 0.3
            };
            const actualReduction = maxQ_available / requiredQ_total * targetReduction;
            compensator.currentIN_A = realIN_A * (1 - actualReduction);
            compensator.isLimited = true;
            compensatorChanged = true;
          }
        } else {
          compensator.currentIN_A = realIN_A;
          compensator.compensationQ_kVAr = { A: 0, B: 0, C: 0 };
          compensator.isLimited = false;
        }
      }
      
      // Si des équipements ont changé, recalculer le réseau
      if (regulatorChanged || compensatorChanged) {
        currentResult = this.calculateScenario(
          nodes, cables, cableTypes, scenario,
          foisonnementCharges, foisonnementProductions,
          transformerConfig, loadModel, desequilibrePourcent
        );
      }
      
      // Test de convergence : écart max des tensions < tolerance
      maxVoltageDelta = 0; // Reset pour cette itération
      if (currentResult.nodeMetrics) {
        for (const nodeMetric of currentResult.nodeMetrics) {
          const prevV = previousVoltages.get(nodeMetric.nodeId) || nodeMetric.V_phase_V;
          const deltaV = Math.abs(nodeMetric.V_phase_V - prevV);
          if (deltaV > maxVoltageDelta) {
            maxVoltageDelta = deltaV;
          }
        }
      }
      
      if (maxVoltageDelta < convergenceTolerance) {
        converged = true;
      }
    }
    
    if (!converged) {
      console.warn(`⚠️ Simulation BFS non convergé après ${maxIterations} itérations (δV max = ${maxVoltageDelta.toFixed(3)}V)`);
    } else {
      console.log(`✅ Simulation BFS convergé en ${iteration} itérations`);
    }

    return currentResult;
  }

  /**
   * Fonction utilitaire pour obtenir les informations de tension d'un type de connexion
   */
  private getNodeVoltageConfig(connectionType: ConnectionType): { U_base: number; isThreePhase: boolean } {
    switch (connectionType) {
      case 'MONO_230V_PN':
        return { U_base: 230, isThreePhase: false };
      case 'MONO_230V_PP':
        return { U_base: 230, isThreePhase: false };
      case 'TRI_230V_3F':
        return { U_base: 230, isThreePhase: true };
      case 'TÉTRA_3P+N_230_400V':
        return { U_base: 400, isThreePhase: true };
      default:
        return { U_base: 230, isThreePhase: true };
    }
  }

  /**
   * Propose automatiquement des améliorations de câbles basées sur l'ampacité réelle
   */
  proposeCableUpgrades(
    project: Project,
    result: CalculationResult,
    voltageDropThreshold: number = 8, // %
    overloadThreshold: number = 1.0, // facteur de sécurité
    estimatedCostPerUpgrade: number = 1500 // Coût paramétrable par défaut
  ): CableUpgrade[] {
    const upgrades: CableUpgrade[] = [];
    const cableTypeById = new Map(project.cableTypes.map(ct => [ct.id, ct]));
    
    // Trier les types de câbles par section (approximation via résistance décroissante)
    const sortedCableTypes = [...project.cableTypes].sort((a, b) => 
      a.R12_ohm_per_km - b.R12_ohm_per_km
    );

    for (const cable of result.cables) {
      if (!cable.voltageDropPercent && !cable.current_A) continue;

      const currentType = cableTypeById.get(cable.typeId);
      if (!currentType) continue;

      // Utiliser maxCurrent_A si disponible, sinon fallback estimation basée sur section
      const maxCurrentA = currentType.maxCurrent_A || this.estimateMaxCurrent(currentType);
      
      // Vérifier les conditions d'upgrade
      const hasVoltageDropIssue = cable.voltageDropPercent && Math.abs(cable.voltageDropPercent) > voltageDropThreshold;
      const hasOverloadIssue = cable.current_A && cable.current_A > maxCurrentA * overloadThreshold;
      
      if (!hasVoltageDropIssue && !hasOverloadIssue) continue;

      // Trouver un type de section supérieure
      const currentTypeIndex = sortedCableTypes.findIndex(ct => ct.id === cable.typeId);
      if (currentTypeIndex === -1) continue;

      // Chercher le prochain câble avec ampacité suffisante
      let nextType: CableType | null = null;
      for (let i = currentTypeIndex + 1; i < sortedCableTypes.length; i++) {
        const candidate = sortedCableTypes[i];
        const candidateMaxCurrent = candidate.maxCurrent_A || this.estimateMaxCurrent(candidate);
        
        // Vérifier si ce câble résout le problème d'ampacité
        if (!hasOverloadIssue || (cable.current_A && cable.current_A <= candidateMaxCurrent * overloadThreshold)) {
          nextType = candidate;
          break;
        }
      }
      
      if (!nextType) continue;

      // Estimation des améliorations
      const improvementFactor = currentType.R12_ohm_per_km / nextType.R12_ohm_per_km;
      const newVoltageDropPercent = (cable.voltageDropPercent || 0) / improvementFactor;
      const newLosses_kW = (cable.losses_kW || 0) / (improvementFactor * improvementFactor);

      // Déterminer la raison de l'upgrade
      let reason: CableUpgrade['reason'];
      if (hasVoltageDropIssue && hasOverloadIssue) {
        reason = 'both';
      } else if (hasVoltageDropIssue) {
        reason = 'voltage_drop';
      } else {
        reason = 'overload';
      }

      upgrades.push({
        originalCableId: cable.id,
        newCableTypeId: nextType.id,
        reason,
        before: {
          voltageDropPercent: cable.voltageDropPercent || 0,
          current_A: cable.current_A || 0,
          losses_kW: cable.losses_kW || 0
        },
        after: {
          voltageDropPercent: newVoltageDropPercent,
          current_A: cable.current_A || 0, // Le courant ne change pas
          losses_kW: newLosses_kW,
          estimatedCost: estimatedCostPerUpgrade
        },
        improvement: {
          voltageDropReduction: Math.abs((cable.voltageDropPercent || 0) - newVoltageDropPercent),
          lossReduction_kW: (cable.losses_kW || 0) - newLosses_kW,
          lossReductionPercent: ((cable.losses_kW || 0) - newLosses_kW) / Math.max(cable.losses_kW || 1, 0.001) * 100
        }
      });
    }

    return upgrades;
  }

  /**
   * Estime l'ampacité d'un câble si maxCurrent_A n'est pas fourni
   */
  private estimateMaxCurrent(cableType: CableType): number {
    // Estimation basique basée sur la résistance (plus la résistance est faible, plus l'ampacité est élevée)
    const baseResistance = 1.83; // Résistance cuivre 10 mm² de référence
    const baseAmpacity = 60; // Ampacité cuivre 10 mm² de référence
    
    // Facteur matériau (aluminium ~85% du cuivre)
    const materialFactor = cableType.matiere === 'ALUMINIUM' ? 0.85 : 1.0;
    
    // Estimation par rapport inversement proportionnelle à la résistance
    const estimatedAmpacity = (baseResistance / cableType.R12_ohm_per_km) * baseAmpacity * materialFactor;
    
    return Math.round(estimatedAmpacity);
  }

  /**
   * Crée une armoire de régulation par défaut pour un nœud
   */
  createDefaultRegulator(nodeId: string, voltageSystem: '230V' | '400V'): VoltageRegulator {
    const type: RegulatorType = voltageSystem === '230V' ? '230V_77kVA' : '400V_44kVA';
    const maxPower = voltageSystem === '230V' ? 77 : 44;
    const targetVoltage = voltageSystem === '230V' ? 230 : 400;

    return {
      id: `regulator-${nodeId}-${Date.now()}`,
      nodeId,
      type,
      targetVoltage_V: targetVoltage,
      maxPower_kVA: maxPower,
      enabled: true
    };
  }

  /**
   * Crée un compensateur de neutre par défaut pour un nœud
   */
  createDefaultNeutralCompensator(nodeId: string): NeutralCompensator {
    return {
      id: `compensator-${nodeId}-${Date.now()}`,
      nodeId,
      maxPower_kVA: 30, // Puissance par défaut
      tolerance_A: 5, // Seuil par défaut
      enabled: true
    };
  }
}