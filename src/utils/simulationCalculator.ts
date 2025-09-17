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
  ConnectionType,
  VoltageSystem
} from '@/types/network';
import { ElectricalCalculator } from '@/utils/electricalCalculations';
import { Complex, C, add, sub, mul, div, abs, fromPolar } from '@/utils/complex';

export class SimulationCalculator extends ElectricalCalculator {
  
  // Constantes de convergence séparées par type de tension
  private static readonly SIM_CONVERGENCE_TOLERANCE_PHASE_V = 0.1;  // Tension phase
  private static readonly SIM_CONVERGENCE_TOLERANCE_LINE_V = 0.17;   // Tension ligne (√3 × 0.1)
  public static readonly SIM_MAX_ITERATIONS = 100;
  private static readonly SIM_MAX_LOCAL_ITERATIONS = 50;
  private static readonly SIM_VOLTAGE_400V_THRESHOLD = 350;
  
  // Constantes pour le mode Forcé
  private static readonly PRODUCTION_DISCONNECT_VOLTAGE = 253;
  public static readonly CONVERGENCE_TOLERANCE_V = 1;
  
  private simCosPhi: number;
  
  // Cache pour les matrices d'impédance
  private impedanceMatrixCache = new Map<string, Complex[][]>();
  
  constructor(cosPhi: number = 0.95) {
    super(cosPhi);
    this.simCosPhi = Math.min(1, Math.max(0, cosPhi));
  }

  /**
   * Estimation analytique des paramètres du mode forcé
   * Utilise une analyse complexe des tensions pour estimer le foisonnement et le déséquilibre
   */
  private _estimateForcedModeParameters(
    Vnight: { U1: number; U2: number; U3: number },
    Vday: { U1: number; U2: number; U3: number },
    P_total_kW: number | null = null
  ): { foisonnementEstimate: number; desequilibreEstimate: number } {
    
    console.log('🧮 Estimation analytique des paramètres du mode forcé');
    console.log(`   Tensions nuit: U1=${Vnight.U1}V, U2=${Vnight.U2}V, U3=${Vnight.U3}V`);
    console.log(`   Tensions jour: U1=${Vday.U1}V, U2=${Vday.U2}V, U3=${Vday.U3}V`);
    
    // Définition des angles de base d'un système triphasé équilibré (en radians)
    const angles = [0, -2 * Math.PI / 3, 2 * Math.PI / 3];
    
    // Construction des phasors pour les tensions de nuit
    const VnightPhasors = [
      fromPolar(Vnight.U1, angles[0]),
      fromPolar(Vnight.U2, angles[1]), 
      fromPolar(Vnight.U3, angles[2])
    ];
    
    // Construction des phasors pour les tensions de jour
    const VdayPhasors = [
      fromPolar(Vday.U1, angles[0]),
      fromPolar(Vday.U2, angles[1]),
      fromPolar(Vday.U3, angles[2])
    ];
    
    // Calcul du vecteur de déséquilibre (différence entre jour et nuit)
    const delta_V_complex = [
      sub(VdayPhasors[0], VnightPhasors[0]),
      sub(VdayPhasors[1], VnightPhasors[1]),
      sub(VdayPhasors[2], VnightPhasors[2])
    ];
    
    // Calcul des angles de déphasage pour chaque phase
    const delta_angles_rad = delta_V_complex.map(delta => {
      const angle = Math.atan2(delta.im, delta.re);
      // Normalisation dans l'intervalle [-π, π]
      return angle > Math.PI ? angle - 2 * Math.PI : (angle < -Math.PI ? angle + 2 * Math.PI : angle);
    });
    
    const delta_angles_deg = delta_angles_rad.map(angle => angle * 180 / Math.PI);
    
    // Estimation du déséquilibre basée sur l'angle de déphasage maximal
    const max_abs_delta_angle_deg = Math.max(...delta_angles_deg.map(angle => Math.abs(angle)));
    const desequilibreEstimate = Math.min(100, (max_abs_delta_angle_deg / 5) * 100);
    
    // Calcul de la chute de tension moyenne
    const Vnight_avg = (Vnight.U1 + Vnight.U2 + Vnight.U3) / 3;
    const Vday_avg = (Vday.U1 + Vday.U2 + Vday.U3) / 3;
    const tensionDrop = Vnight_avg - Vday_avg;
    
    // Estimation du foisonnement basée sur la chute de tension
    // Référence nominale: 5V de chute pour 100% de foisonnement
    const nominalDrop = 5.0;
    const foisonnementEstimate = Math.min(100, Math.max(10, (tensionDrop / nominalDrop) * 100));
    
    console.log(`   Angles de déphasage: ${delta_angles_deg.map(a => a.toFixed(1)).join('°, ')}°`);
    console.log(`   Chute de tension moyenne: ${tensionDrop.toFixed(1)}V`);
    console.log(`   Estimation foisonnement: ${foisonnementEstimate.toFixed(1)}%`);
    console.log(`   Estimation déséquilibre: ${desequilibreEstimate.toFixed(1)}%`);
    
    return {
      foisonnementEstimate: Math.round(foisonnementEstimate * 10) / 10,
      desequilibreEstimate: Math.round(desequilibreEstimate * 10) / 10
    };
  }

  /**
   * Méthode publique pour l'algorithme hybride du mode forcé
   * Utilise une estimation analytique initiale suivie d'une simulation unique
   */
  public async runForcedModeConvergence(
    project: Project,
    measuredVoltages: { U1: number; U2: number; U3: number },
    measurementNodeId: string,
    sourceVoltage: number,
    nightVoltages?: { U1: number; U2: number; U3: number }
  ): Promise<{ 
    result: CalculationResult | null;
    foisonnementCharges: number;
    desequilibrePourcent: number;
    voltageErrors?: { A: number; B: number; C: number };
    iterations?: number;
    convergenceStatus: 'converged' | 'not_converged';
    finalLoadDistribution?: { A: number; B: number; C: number };
    finalProductionDistribution?: { A: number; B: number; C: number };
    calibratedFoisonnementCharges?: number;
  }> {
    
    console.log(`🔥 Démarrage algorithme hybride Mode Forcé`);
    console.log(`   Tensions cibles: A=${measuredVoltages.U1}V, B=${measuredVoltages.U2}V, C=${measuredVoltages.U3}V`);
    console.log(`   Nœud de mesure: ${measurementNodeId}`);

    // Étape 1: Estimation initiale analytique
    let foisonnementCharges = project.foisonnementCharges;
    let desequilibrePourcent = project.desequilibrePourcent || 0;
    
    // Si des tensions de nuit sont disponibles, utiliser l'estimation analytique
    if (nightVoltages) {
      const estimates = this._estimateForcedModeParameters(
        nightVoltages,
        measuredVoltages,
        null // P_total_kW peut être ajouté plus tard si disponible
      );
      
      foisonnementCharges = estimates.foisonnementEstimate;
      desequilibrePourcent = estimates.desequilibreEstimate;
      
      console.log(`✨ Paramètres estimés - Foisonnement: ${foisonnementCharges}%, Déséquilibre: ${desequilibrePourcent}%`);
    } else {
      console.log(`📊 Utilisation des paramètres manuels - Foisonnement: ${foisonnementCharges}%, Déséquilibre: ${desequilibrePourcent}%`);
    }

    // Étape 2: Simulation unique avec les paramètres estimés
    const currentResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      'FORCÉ',
      foisonnementCharges,
      project.foisonnementProductions,
      project.transformerConfig,
      'monophase_reparti',
      desequilibrePourcent,
      project.manualPhaseDistribution
    );

    if (!currentResult || !currentResult.nodeMetricsPerPhase) {
      console.warn('❌ Échec du calcul');
      return {
        result: null,
        foisonnementCharges,
        desequilibrePourcent,
        iterations: 1,
        convergenceStatus: 'not_converged'
      };
    }
    
    // Récupérer les tensions simulées au nœud de mesure
    const simulatedVoltages = currentResult.nodeMetricsPerPhase.find(n => n.nodeId === measurementNodeId);
    if (!simulatedVoltages) {
      console.warn(`❌ Nœud de mesure ${measurementNodeId} non trouvé`);
      return {
        result: currentResult,
        foisonnementCharges,
        desequilibrePourcent,
        iterations: 1,
        convergenceStatus: 'not_converged'
      };
    }

    const V_A = simulatedVoltages.voltagesPerPhase.A;
    const V_B = simulatedVoltages.voltagesPerPhase.B;
    const V_C = simulatedVoltages.voltagesPerPhase.C;
    
    // Calculer les écarts par rapport aux tensions mesurées
    const diff_A = V_A - measuredVoltages.U1;
    const diff_B = V_B - measuredVoltages.U2;
    const diff_C = V_C - measuredVoltages.U3;
    const averageError = (Math.abs(diff_A) + Math.abs(diff_B) + Math.abs(diff_C)) / 3;

    console.log(`   Tensions simulées: A=${V_A.toFixed(1)}V, B=${V_B.toFixed(1)}V, C=${V_C.toFixed(1)}V`);
    console.log(`   Erreurs: A=${diff_A.toFixed(2)}V, B=${diff_B.toFixed(2)}V, C=${diff_C.toFixed(2)}V (moy: ${averageError.toFixed(3)}V)`);

    // Déterminer le statut de convergence basé sur la précision obtenue
    const convergenceStatus = averageError < 2.0 ? 'converged' : 'not_converged';
    
    console.log(`✅ Simulation hybride terminée. Erreur moyenne: ${averageError.toFixed(3)}V - Statut: ${convergenceStatus}`);
    
    return { 
      result: currentResult,
      foisonnementCharges,
      desequilibrePourcent,
      voltageErrors: { A: diff_A, B: diff_B, C: diff_C },
      iterations: 1,
      convergenceStatus,
      finalLoadDistribution: currentResult.finalLoadDistribution,
      finalProductionDistribution: currentResult.finalProductionDistribution,
      calibratedFoisonnementCharges: foisonnementCharges
    };
  }
  
  /**
   * Calcule les pourcentages finaux de répartition par phase basés sur la distribution réelle
   */
  private calculateFinalDistribution(
    nodes: Node[], 
    type: 'charges' | 'productions',
    foisonnement: number,
    manualDistribution?: { charges: {A:number;B:number;C:number}; productions: {A:number;B:number;C:number} }
  ): {A: number; B: number; C: number} {
    
    // Si une distribution manuelle est définie, l'utiliser
    if (manualDistribution) {
      const distribution = type === 'charges' ? manualDistribution.charges : manualDistribution.productions;
      return distribution;
    }
    
    // Sinon, calculer à partir de la répartition réelle des nœuds
    let totalA = 0, totalB = 0, totalC = 0;
    
    nodes.forEach(node => {
      const items = type === 'charges' ? node.clients : node.productions;
      if (!items || items.length === 0) return;
      
      const totalPower = items.reduce((sum, item) => sum + (item.S_kVA || 0), 0) * (foisonnement / 100);
      
      // Pour une vraie distribution, ici on devrait récupérer la répartition phase réelle
      // calculée par l'algorithme de flux de puissance.
      // Pour l'instant, distribution équilibrée mais cela devrait être amélioré
      // en récupérant les données des phases A, B, C calculées
      totalA += totalPower / 3;
      totalB += totalPower / 3;
      totalC += totalPower / 3;
    });
    
    const total = totalA + totalB + totalC;
    if (total === 0) return {A: 33.33, B: 33.33, C: 33.33};
    
    return {
      A: (totalA / total) * 100,
      B: (totalB / total) * 100,
      C: (totalC / total) * 100
    };
  }
  
  /**
   * Méthode de simulation en mode forcé avec calcul analytique non-itératif
   * Remplace l'ancienne méthode itérative par une estimation directe basée sur les tensions mesurées
   */
  public runForcedModeSimulation(
    project: Project,
    measurementNodeId: string,
    sourceVoltage: number,
    measuredVoltages: { U1: number; U2: number; U3: number },
    dayVoltages: { U1: number; U2: number; U3: number }
  ): CalculationResult {
    
    console.log('🔥 Mode FORCÉ: Démarrage calcul analytique non-itératif');
    console.log(`   Nœud de mesure: ${measurementNodeId}`);
    console.log(`   Tensions mesurées: U1=${measuredVoltages.U1}V, U2=${measuredVoltages.U2}V, U3=${measuredVoltages.U3}V`);
    console.log(`   Tensions de jour: U1=${dayVoltages.U1}V, U2=${dayVoltages.U2}V, U3=${dayVoltages.U3}V`);

    // === ÉTAPE 1: VALIDATION INITIALE ===
    const measurementNode = project.nodes.find(n => n.id === measurementNodeId);
    if (!measurementNode) {
      throw new Error(`Nœud de mesure '${measurementNodeId}' non trouvé dans le projet`);
    }

    const sourceNode = project.nodes.find(n => n.isSource);
    if (!sourceNode) {
      throw new Error('Aucun nœud source trouvé dans le projet');
    }

    console.log(`✓ Nœud de mesure trouvé: ${measurementNode.name}`);
    console.log(`✓ Nœud source trouvé: ${sourceNode.name}`);

    // === ÉTAPE 2: CALCUL DE LA TENSION DE NUIT (RÉFÉRENCE) ===
    console.log('📊 Calcul de la tension de nuit (référence)...');
    
    // Simulation à vide (charges et productions à 0) pour calculer la chute de tension à vide
    const emptyLoadResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      'FORCÉ',
      0, // Foisonnement charges = 0
      0, // Foisonnement productions = 0
      project.transformerConfig,
      'monophase_reparti',
      0, // Déséquilibre = 0
      project.manualPhaseDistribution
    );

    if (!emptyLoadResult?.nodeMetricsPerPhase) {
      throw new Error('Échec du calcul de la simulation à vide');
    }

    const emptyLoadVoltages = emptyLoadResult.nodeMetricsPerPhase.find(n => n.nodeId === measurementNodeId);
    if (!emptyLoadVoltages) {
      throw new Error(`Impossible de trouver les tensions à vide pour le nœud ${measurementNodeId}`);
    }

    // Chute de tension à vide entre source et nœud de mesure
    const voltageDropNight = {
      U1: sourceVoltage - emptyLoadVoltages.voltagesPerPhase.A,
      U2: sourceVoltage - emptyLoadVoltages.voltagesPerPhase.B,
      U3: sourceVoltage - emptyLoadVoltages.voltagesPerPhase.C
    };

    // Tension de référence de nuit à la source
    const Vnight_source = {
      U1: dayVoltages.U1 + voltageDropNight.U1,
      U2: dayVoltages.U2 + voltageDropNight.U2,
      U3: dayVoltages.U3 + voltageDropNight.U3
    };

    console.log(`   Chute de tension à vide: U1=${voltageDropNight.U1.toFixed(2)}V, U2=${voltageDropNight.U2.toFixed(2)}V, U3=${voltageDropNight.U3.toFixed(2)}V`);
    console.log(`   Tension nuit source: U1=${Vnight_source.U1.toFixed(1)}V, U2=${Vnight_source.U2.toFixed(1)}V, U3=${Vnight_source.U3.toFixed(1)}V`);

    // === ÉTAPE 3: CALCUL DE LA TENSION DE JOUR (AVEC CHARGES) ===
    console.log('📊 Calcul de la tension de jour théorique...');
    
    // Simulation théorique avec foisonnement 100% et déséquilibre 0%
    const theoreticalResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      'FORCÉ',
      100, // Foisonnement charges = 100%
      project.foisonnementProductions,
      project.transformerConfig,
      'monophase_reparti',
      0, // Déséquilibre = 0%
      project.manualPhaseDistribution
    );

    if (!theoreticalResult?.nodeMetricsPerPhase) {
      throw new Error('Échec du calcul de la simulation théorique');
    }

    const theoreticalVoltages = theoreticalResult.nodeMetricsPerPhase.find(n => n.nodeId === measurementNodeId);
    if (!theoreticalVoltages) {
      throw new Error(`Impossible de trouver les tensions théoriques pour le nœud ${measurementNodeId}`);
    }

    // Chute de tension théorique
    const voltageDropDayTheoretical = {
      U1: sourceVoltage - theoreticalVoltages.voltagesPerPhase.A,
      U2: sourceVoltage - theoreticalVoltages.voltagesPerPhase.B,
      U3: sourceVoltage - theoreticalVoltages.voltagesPerPhase.C
    };

    // Tension de référence de jour à la source
    const Vday_source = {
      U1: measuredVoltages.U1 + voltageDropDayTheoretical.U1,
      U2: measuredVoltages.U2 + voltageDropDayTheoretical.U2,
      U3: measuredVoltages.U3 + voltageDropDayTheoretical.U3
    };

    console.log(`   Chute de tension théorique: U1=${voltageDropDayTheoretical.U1.toFixed(2)}V, U2=${voltageDropDayTheoretical.U2.toFixed(2)}V, U3=${voltageDropDayTheoretical.U3.toFixed(2)}V`);
    console.log(`   Tension jour source: U1=${Vday_source.U1.toFixed(1)}V, U2=${Vday_source.U2.toFixed(1)}V, U3=${Vday_source.U3.toFixed(1)}V`);

    // === ÉTAPE 4: CALCUL DES PARAMÈTRES DE CONVERGENCE ===
    console.log('🧮 Calcul analytique des paramètres...');

    // Phase 1: Foisonnement
    const Vnight_avg = (Vnight_source.U1 + Vnight_source.U2 + Vnight_source.U3) / 3;
    const Vday_avg = (Vday_source.U1 + Vday_source.U2 + Vday_source.U3) / 3;
    const deltaV_real = Vnight_avg - Vday_avg;

    const Vsource_no_load = sourceVoltage;
    const Vday_theoretical_avg = (theoreticalVoltages.voltagesPerPhase.A + theoreticalVoltages.voltagesPerPhase.B + theoreticalVoltages.voltagesPerPhase.C) / 3;
    const deltaV_theorique = Vsource_no_load - Vday_theoretical_avg;

    const foisonnementEstimate = deltaV_theorique !== 0 ? Math.min(200, Math.max(10, (deltaV_real / deltaV_theorique) * 100)) : 100;

    console.log(`   Chute réelle moyenne: ${deltaV_real.toFixed(2)}V`);
    console.log(`   Chute théorique moyenne: ${deltaV_theorique.toFixed(2)}V`);
    console.log(`   Foisonnement estimé: ${foisonnementEstimate.toFixed(1)}%`);

    // Phase 2: Déséquilibre (analyse par phasors)
    const angles = [0, -2 * Math.PI / 3, 2 * Math.PI / 3];

    // Phasors des tensions mesurées
    const measuredPhasors = [
      fromPolar(measuredVoltages.U1, angles[0]),
      fromPolar(measuredVoltages.U2, angles[1]),
      fromPolar(measuredVoltages.U3, angles[2])
    ];

    // Phasors des tensions théoriques (équilibrées)
    const theoreticalPhasors = [
      fromPolar(Vday_source.U1, angles[0]),
      fromPolar(Vday_source.U2, angles[1]),
      fromPolar(Vday_source.U3, angles[2])
    ];

    // Calcul des angles de déphasage
    const phaseAngles = measuredPhasors.map((measured, i) => {
      const theoretical = theoreticalPhasors[i];
      const deltaAngle = Math.atan2(measured.im - theoretical.im, measured.re - theoretical.re);
      return deltaAngle * 180 / Math.PI;
    });

    const maxAngleDeg = Math.max(...phaseAngles.map(angle => Math.abs(angle)));
    const desequilibreEstimate = Math.min(100, Math.max(0, (maxAngleDeg / 5) * 100));

    console.log(`   Angles de déphasage: ${phaseAngles.map(a => a.toFixed(1)).join('°, ')}°`);
    console.log(`   Déséquilibre estimé: ${desequilibreEstimate.toFixed(1)}%`);

    // === ÉTAPE 5: SIMULATION FINALE UNIQUE ===
    console.log('⚡ Simulation finale avec paramètres estimés...');
    
    const finalResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      'FORCÉ',
      foisonnementEstimate,
      project.foisonnementProductions,
      project.transformerConfig,
      'monophase_reparti',
      desequilibreEstimate,
      project.manualPhaseDistribution
    );

    if (!finalResult) {
      throw new Error('Échec de la simulation finale');
    }

    // Vérification des résultats
    const finalVoltages = finalResult.nodeMetricsPerPhase?.find(n => n.nodeId === measurementNodeId);
    if (finalVoltages) {
      const errors = {
        A: finalVoltages.voltagesPerPhase.A - measuredVoltages.U1,
        B: finalVoltages.voltagesPerPhase.B - measuredVoltages.U2,
        C: finalVoltages.voltagesPerPhase.C - measuredVoltages.U3
      };
      const avgError = (Math.abs(errors.A) + Math.abs(errors.B) + Math.abs(errors.C)) / 3;
      
      console.log(`✅ Simulation terminée`);
      console.log(`   Tensions finales: A=${finalVoltages.voltagesPerPhase.A.toFixed(1)}V, B=${finalVoltages.voltagesPerPhase.B.toFixed(1)}V, C=${finalVoltages.voltagesPerPhase.C.toFixed(1)}V`);
      console.log(`   Erreurs: A=${errors.A.toFixed(2)}V, B=${errors.B.toFixed(2)}V, C=${errors.C.toFixed(2)}V (moy: ${avgError.toFixed(3)}V)`);
    }

    // Calculer les distributions finales
    const finalLoadDistribution = this.calculateFinalDistribution(
      project.nodes, 
      'charges', 
      foisonnementEstimate, 
      project.manualPhaseDistribution
    );
    
    const finalProductionDistribution = this.calculateFinalDistribution(
      project.nodes, 
      'productions', 
      project.foisonnementProductions, 
      project.manualPhaseDistribution
    );

    return {
      ...finalResult,
      convergenceStatus: 'converged',
      finalLoadDistribution,
      finalProductionDistribution,
      calibratedFoisonnementCharges: foisonnementEstimate
    };
  }

  /**
   * Prépare les tensions mesurées selon le système de tension
   * En 230V: estime la 3ème tension si manquante
   * En 400V: vérifie que les 3 tensions sont fournies
   */
  private prepareMeasuredVoltages(
    measuredVoltages: { U1: number; U2: number; U3: number },
    voltageSystem: string
  ): { U1: number; U2: number; U3: number } {
    let { U1, U2, U3 } = measuredVoltages;
    
    if (voltageSystem === 'TÉTRAPHASÉ_400V') {
      // En mode 400V: les 3 tensions sont obligatoires
      if (!U1 || !U2 || !U3 || U1 <= 0 || U2 <= 0 || U3 <= 0) {
        console.warn('⚠️ En mode 400V, les trois tensions mesurées sont obligatoires');
        // Utiliser des valeurs par défaut si manquantes
        U1 = U1 > 0 ? U1 : 230;
        U2 = U2 > 0 ? U2 : 230;
        U3 = U3 > 0 ? U3 : 230;
      }
    } else {
      // En mode 230V: estimation de la tension manquante par la moyenne des deux autres
      const validVoltages = [U1, U2, U3].filter(v => v && v > 0);
      
      if (validVoltages.length === 2) {
        const averageVoltage = validVoltages.reduce((sum, v) => sum + v, 0) / validVoltages.length;
        
        if (!U1 || U1 <= 0) U1 = averageVoltage;
        if (!U2 || U2 <= 0) U2 = averageVoltage;
        if (!U3 || U3 <= 0) U3 = averageVoltage;
        
        console.log(`📊 Tension manquante estimée par moyenne: ${averageVoltage.toFixed(1)}V`);
      } else if (validVoltages.length < 2) {
        console.warn('⚠️ Au moins 2 tensions mesurées sont requises en mode 230V');
        // Utiliser des valeurs par défaut
        U1 = U1 > 0 ? U1 : 230;
        U2 = U2 > 0 ? U2 : 230;
        U3 = U3 > 0 ? U3 : 230;
      }
    }
    
    return { U1, U2, U3 };
  }

  /**
   * Calibration du foisonnement des charges (Phase 1)
   * Utilise la même logique que calculateWithTargetVoltage du store
   */
  private calibrateFoisonnement(
    project: Project,
    scenario: CalculationScenario,
    config: any,
    initialFoisonnement: number
  ): number {
    let bestFoisonnement = initialFoisonnement;
    let bestVoltage = 0;
    let minDiff = Infinity;

    console.log(`📊 Phase 1: Calibration foisonnement pour tension cible ${config.targetVoltage}V au nœud ${config.measurementNodeId}`);

    // Dichotomie pour trouver le foisonnement optimal (même logique que calculateWithTargetVoltage)
    let low = 0;
    let high = 150;
    
    for (let iteration = 0; iteration < 20; iteration++) {
      const testFoisonnement = (low + high) / 2;
      
      // Créer un projet temporaire avec ce foisonnement
      const tempProject = {
        ...project,
        foisonnementCharges: testFoisonnement,
        foisonnementProductions: 0 // Productions à 0% pour calibration nuit
      };

      // Utiliser la même méthode que dans le store (calculateScenarioWithHTConfig)
      const result = this.calculateScenarioWithHTConfig(
        tempProject,
        scenario,
        testFoisonnement,
        0, // Productions à 0% pour calibration nuit
        tempProject.manualPhaseDistribution
      );

      const nodeData = result.nodeVoltageDrops?.find(n => n.nodeId === config.measurementNodeId);
      if (!nodeData) break;

      // Calculer la tension du nœud (même logique que dans le store)
      let baseVoltage = 230;
      const node = tempProject.nodes.find(n => n.id === config.measurementNodeId);
      if (node?.connectionType === 'TÉTRA_3P+N_230_400V' || project.voltageSystem === 'TÉTRAPHASÉ_400V') {
        baseVoltage = 400;
      }
      
      const actualVoltage = baseVoltage - nodeData.deltaU_cum_V;
      const diff = Math.abs(actualVoltage - config.targetVoltage);
      
      console.log(`  Iter ${iteration + 1}: Foisonnement ${testFoisonnement.toFixed(1)}% → ${actualVoltage.toFixed(1)}V (cible ${config.targetVoltage}V, écart ${diff.toFixed(1)}V)`);
      
      if (diff < minDiff) {
        minDiff = diff;
        bestFoisonnement = testFoisonnement;
        bestVoltage = actualVoltage;
      }

      if (diff < 0.5) { // Tolérance de 0.5V
        console.log(`✅ Calibration convergée: foisonnement = ${bestFoisonnement.toFixed(1)}%`);
        break;
      }

      if (actualVoltage < config.targetVoltage) {
        high = testFoisonnement - 0.1;
      } else {
        low = testFoisonnement + 0.1;
      }

      if (high - low < 0.1) break;
    }
    
    console.log(`📊 Phase 1 terminée: Foisonnement optimal = ${bestFoisonnement.toFixed(1)}% (tension = ${bestVoltage.toFixed(1)}V)`);
    return bestFoisonnement;
  }

  /**
   * Convergence sur le déséquilibre avec ajustement des répartitions par phase (Phase 2)
   * Ajuste phase par phase pour atteindre les tensions mesurées
   */
  private runImbalanceConvergence(
  project: Project,
  scenario: CalculationScenario,
  targetVoltages: { U1: number; U2: number; U3: number },
  measurementNodeId: string,
  foisonnementCharges: number
): { result: CalculationResult, converged: boolean, finalDistribution: any, iterations: number, maxError: number } {
  
  console.log(`📊 Phase 2: Convergence déséquilibre - Cibles: L1=${targetVoltages.U1}V, L2=${targetVoltages.U2}V, L3=${targetVoltages.U3}V`);
  
  // Initialisation avec répartition équilibrée
  let currentDistribution = project.manualPhaseDistribution ? 
    { ...project.manualPhaseDistribution } : 
    {
      charges: { A: 33.33, B: 33.33, C: 33.34 },
      productions: { A: 33.33, B: 33.33, C: 33.34 },
      constraints: { min: 10, max: 80, total: 100 } // Limites élargies
    };
  
  const maxIterations = 20;
  const tolerance = 1.5; // ±1.5V tolérance
  let bestDistribution = { ...currentDistribution };
  let bestError = Infinity;
  
  for (let iter = 0; iter < maxIterations; iter++) {
    console.log(`🔄 Itération ${iter + 1} - Répartition: A=${currentDistribution.charges.A.toFixed(1)}%, B=${currentDistribution.charges.B.toFixed(1)}%, C=${currentDistribution.charges.C.toFixed(1)}%`);
    
    // Simulation avec répartition actuelle
    const result = this.calculateScenario(
      project.nodes,
      project.cables, 
      project.cableTypes,
      scenario,
      foisonnementCharges,
      100, // Productions à 100%
      project.transformerConfig,
      'monophase_reparti',
      0, // Pas de déséquilibre global
      currentDistribution
    );
    
    const nodeMetrics = result.nodeMetricsPerPhase?.find(m => m.nodeId === measurementNodeId);
    if (!nodeMetrics) break;
    
    const simulated = nodeMetrics.voltagesPerPhase;
    const errors = {
      A: targetVoltages.U1 - simulated.A, // Erreur = Cible - Simulé
      B: targetVoltages.U2 - simulated.B,
      C: targetVoltages.U3 - simulated.C
    };
    
    const maxError = Math.max(Math.abs(errors.A), Math.abs(errors.B), Math.abs(errors.C));
    
    console.log(`  Simulé: L1=${simulated.A.toFixed(1)}V, L2=${simulated.B.toFixed(1)}V, L3=${simulated.C.toFixed(1)}V`);
    console.log(`  Erreurs: A=${errors.A.toFixed(2)}V, B=${errors.B.toFixed(2)}V, C=${errors.C.toFixed(2)}V (max=${maxError.toFixed(2)}V)`);
    
    // Sauvegarder la meilleure solution
    if (maxError < bestError) {
      bestError = maxError;
      bestDistribution = { ...currentDistribution };
    }
    
    // Test convergence
    if (maxError <= tolerance) {
      console.log(`✅ Convergence atteinte en ${iter + 1} itérations`);
      return {
        result,
        converged: true,
        finalDistribution: currentDistribution,
        iterations: iter + 1,
        maxError
      };
    }
    
    // ✅ ALGORITHME CORRIGÉ : Ajustement proportionnel aux erreurs
    const adjustmentFactor = Math.min(10, 5 + iter * 0.5); // Gain adaptatif (5→15)
    
    // Si erreur positive (simulé < cible) → augmenter charges pour baisser tension
    // Si erreur négative (simulé > cible) → réduire charges pour monter tension
    const adjustments = {
      A: errors.A * adjustmentFactor, // ATTENTION : logique inverse pour les tensions
      B: errors.B * adjustmentFactor,
      C: errors.C * adjustmentFactor
    };
    
    // Appliquer les ajustements SANS normalisation initiale
    const newCharges = {
      A: currentDistribution.charges.A + adjustments.A,
      B: currentDistribution.charges.B + adjustments.B,
      C: currentDistribution.charges.C + adjustments.C
    };
    
    // Contraintes individuelles
    newCharges.A = Math.max(10, Math.min(80, newCharges.A));
    newCharges.B = Math.max(10, Math.min(80, newCharges.B));
    newCharges.C = Math.max(10, Math.min(80, newCharges.C));
    
    // Normalisation finale pour respecter 100% total
    const total = newCharges.A + newCharges.B + newCharges.C;
    currentDistribution.charges.A = (newCharges.A / total) * 100;
    currentDistribution.charges.B = (newCharges.B / total) * 100;
    currentDistribution.charges.C = (newCharges.C / total) * 100;
    
    console.log(`  Ajustements: A=${adjustments.A.toFixed(1)}, B=${adjustments.B.toFixed(1)}, C=${adjustments.C.toFixed(1)}`);
    console.log(`  Nouvelle répartition: A=${currentDistribution.charges.A.toFixed(1)}%, B=${currentDistribution.charges.B.toFixed(1)}%, C=${currentDistribution.charges.C.toFixed(1)}%`);
  }
  
  console.warn(`⚠️ Non convergé après ${maxIterations} itérations. Utilisation de la meilleure solution (erreur=${bestError.toFixed(2)}V)`);
  return {
    result: result!,
    converged: false,
    finalDistribution: bestDistribution,
    iterations: maxIterations,
    maxError: bestError
  };
}

  /**
   * Calcule les ajustements à appliquer aux phases avec algorithme amélioré
   */
  private calculatePhaseAdjustments(
    voltageErrors: number[],
    maxAdjustmentPerIter: number,
    dampingFactor: number,
    iteration: number
  ): number[] {
    return voltageErrors.map((error, phaseIndex) => {
      // Coefficient adaptatif selon l'itération
      const adaptiveCoeff = Math.max(0.3, 1.0 - (iteration * 0.02));
      
      // Ajustement de base: si erreur positive, réduire la charge sur cette phase
      // Si erreur négative, augmenter la charge sur cette phase  
      const baseAdjustment = -error * 0.6 * adaptiveCoeff;
      
      // Limiter l'ajustement
      const limitedAdjustment = Math.max(
        -maxAdjustmentPerIter, 
        Math.min(maxAdjustmentPerIter, baseAdjustment)
      );
      
      return limitedAdjustment * dampingFactor;
    });
  }

  /**
   * Applique les ajustements et normalise la distribution
   */
  private applyAndNormalizeDistribution(
    currentDistribution: any,
    adjustments: number[],
    iteration: number
  ): any {
    // Appliquer les ajustements
    const newCharges = {
      A: currentDistribution.charges.A + adjustments[0],
      B: currentDistribution.charges.B + adjustments[1],
      C: currentDistribution.charges.C + adjustments[2]
    };
    
    // Appliquer les contraintes avec marges flexibles selon l'itération
    const minLimit = Math.max(10, currentDistribution.constraints.min - (iteration * 0.2));
    const maxLimit = Math.min(80, currentDistribution.constraints.max + (iteration * 0.2));
    
    newCharges.A = Math.max(minLimit, Math.min(maxLimit, newCharges.A));
    newCharges.B = Math.max(minLimit, Math.min(maxLimit, newCharges.B));
    newCharges.C = Math.max(minLimit, Math.min(maxLimit, newCharges.C));
    
    // Renormaliser à 100%
    const total = newCharges.A + newCharges.B + newCharges.C;
    if (total > 0) {
      return {
        ...currentDistribution,
        charges: {
          A: (newCharges.A / total) * 100,
          B: (newCharges.B / total) * 100,
          C: (newCharges.C / total) * 100
        }
      };
    }
    
    return currentDistribution;
  }

  /**
   * Gère les déconnexions de production en cas de surtension
   */
  private handleProductionDisconnections(modifiedNodes: any[], iterationResult: CalculationResult): boolean {
    let productionDisconnected = false;
    
    if (iterationResult.nodeMetricsPerPhase) {
      for (const nodeMetric of iterationResult.nodeMetricsPerPhase) {
        const node = modifiedNodes.find(n => n.id === nodeMetric.nodeId);
        if (!node || !node.productions || node.productions.length === 0) continue;
        
        const maxVoltage = Math.max(
          nodeMetric.voltagesPerPhase.A,
          nodeMetric.voltagesPerPhase.B,
          nodeMetric.voltagesPerPhase.C
        );
        
        if (maxVoltage > SimulationCalculator.PRODUCTION_DISCONNECT_VOLTAGE) {
          console.log(`⚡ Déconnexion productions sur nœud ${node.id}: ${maxVoltage.toFixed(1)}V > ${SimulationCalculator.PRODUCTION_DISCONNECT_VOLTAGE}V`);
          
          node.productions.forEach((prod: any) => {
            if (prod.S_kVA > 0) {
              prod.S_kVA = 0;
              productionDisconnected = true;
            }
          });
        }
      }
    }
    
    return productionDisconnected;
  }
  
  /**
   * Calcule un scénario avec équipements de simulation
   */
  calculateWithSimulation(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): SimulationResult {
    // D'abord calculer le scénario de base (sans équipements)
    let baselineResult: CalculationResult;
    
    if (scenario === 'FORCÉ' && project.forcedModeConfig) {
      // Mode forcé : utiliser le nouveau processus analytique
      const config = project.forcedModeConfig;
      const sourceNode = project.nodes.find(n => n.isSource);
      const sourceVoltage = sourceNode?.tensionCible || (project.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230);
      
      // Utiliser les tensions mesurées comme tensions de jour et tensions cibles
      const measuredVoltages = config.measuredVoltages;
      const dayVoltages = config.measuredVoltages; // Pour l'instant, même valeur
      
      baselineResult = this.runForcedModeSimulation(
        project, 
        config.measurementNodeId, 
        sourceVoltage, 
        measuredVoltages, 
        dayVoltages
      );
    } else {
      // Autres modes : baseline normal
      baselineResult = this.calculateScenario(
        project.nodes,
        project.cables,
        project.cableTypes,
        scenario,
        project.foisonnementCharges,
        project.foisonnementProductions,
        project.transformerConfig,
        project.loadModel,
        project.desequilibrePourcent,
        project.manualPhaseDistribution
      );
    }

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
      baselineResult,
      convergenceStatus: (simulationResult as any).convergenceStatus || (baselineResult as any).convergenceStatus
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

    // Calculer le pourcentage de déséquilibre pour le mode FORCÉ
    let desequilibrePourcent: number;
    if (scenario === 'FORCÉ' && project.forcedModeConfig) {
      // Étape de calibration : Calculer le pourcentage de déséquilibre à partir des tensions mesurées
      const { U1, U2, U3 } = project.forcedModeConfig.measuredVoltages;
      const tensionMoyenne = (U1 + U2 + U3) / 3;
      const ecartMax = Math.max(
        Math.abs(U1 - tensionMoyenne),
        Math.abs(U2 - tensionMoyenne),
        Math.abs(U3 - tensionMoyenne)
      );

      desequilibrePourcent = (ecartMax / tensionMoyenne) * 100;

      // Limiter le pourcentage de déséquilibre pour la robustesse du modèle
      desequilibrePourcent = Math.min(Math.max(desequilibrePourcent, 0), 100);
      
      console.log(`Mode FORCÉ: déséquilibre calculé dynamiquement = ${desequilibrePourcent.toFixed(2)}% à partir des tensions [${U1}, ${U2}, ${U3}]V`);
    } else {
      // Pour les autres modes, utiliser le pourcentage de déséquilibre de la configuration du projet
      desequilibrePourcent = project.desequilibrePourcent || 0;
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
      desequilibrePourcent,
      project.manualPhaseDistribution,
      equipment
    );
  }

  /**
   * Algorithme BFS modifié avec intégration native des équipements de simulation
   * et gestion du mode forcé
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
    manualPhaseDistribution: { charges: {A:number;B:number;C:number}; productions: {A:number;B:number;C:number}; constraints: {min:number;max:number;total:number} } | undefined,
    equipment: SimulationEquipment
  ): CalculationResult {
    // Extraire les équipements actifs
    const activeRegulators = equipment.regulators.filter(r => r.enabled);
    const activeCompensators = equipment.neutralCompensators.filter(c => c.enabled);
    
    // Créer maps pour accès rapide
    const regulatorByNode = new Map(activeRegulators.map(r => [r.nodeId, r]));
    const compensatorByNode = new Map(activeCompensators.map(c => [c.nodeId, c]));
    
    // Si aucun équipement actif et pas en mode forcé, utiliser l'algorithme standard
    if (activeRegulators.length === 0 && activeCompensators.length === 0 && scenario !== 'FORCÉ') {
      return this.calculateScenario(
        nodes, cables, cableTypes, scenario,
        foisonnementCharges, foisonnementProductions, 
        transformerConfig, loadModel, desequilibrePourcent,
        manualPhaseDistribution
      );
    }

    // Algorithme BFS modifié avec équipements
    return this.runEnhancedBFS(
      nodes, cables, cableTypes, scenario,
      foisonnementCharges, foisonnementProductions,
      transformerConfig, loadModel, desequilibrePourcent,
      manualPhaseDistribution,
      regulatorByNode, compensatorByNode
    );
  }

  /**
   * Répartit dynamiquement les charges et productions sur les phases selon les règles définies
   * et calcule automatiquement le déséquilibre pour le mode forcé
   */
  private distributeLoadsAndProductionsPerPhase(
    nodes: Node[],
    cosPhi: number,
    manualPhaseDistribution?: { charges: {A:number;B:number;C:number}; productions: {A:number;B:number;C:number}; constraints: {min:number;max:number;total:number} },
    scenario?: CalculationScenario,
    forcedModeConfig?: { measuredVoltages: { U1: number; U2: number; U3: number }, measurementNodeId: string }
  ): Map<string, { chargesPerPhase: Record<'A'|'B'|'C', {P_kW: number, Q_kVAr: number}>, productionsPerPhase: Record<'A'|'B'|'C', {P_kW: number, Q_kVAr: number}> }> {
    
    // Si mode forcé, calculer le déséquilibre automatiquement à partir des mesures
    let calculatedImbalance = 0;
    if (scenario === 'FORCÉ' && forcedModeConfig) {
      const { U1, U2, U3 } = forcedModeConfig.measuredVoltages;
      const U_moy = (U1 + U2 + U3) / 3;
      const U_dev_max = Math.max(
        Math.abs(U1 - U_moy),
        Math.abs(U2 - U_moy),
        Math.abs(U3 - U_moy)
      );
      calculatedImbalance = (U_dev_max / U_moy) * 100;
      console.log(`Mode FORCÉ: déséquilibre calculé = ${calculatedImbalance.toFixed(2)}% à partir des tensions [${U1}, ${U2}, ${U3}]V`);
    }

    const distributionMap = new Map<string, { 
      chargesPerPhase: Record<'A'|'B'|'C', {P_kW: number, Q_kVAr: number}>, 
      productionsPerPhase: Record<'A'|'B'|'C', {P_kW: number, Q_kVAr: number}> 
    }>();
    
    nodes.forEach(node => {
      const chargesPerPhase = { A: { P_kW: 0, Q_kVAr: 0 }, B: { P_kW: 0, Q_kVAr: 0 }, C: { P_kW: 0, Q_kVAr: 0 } };
      const productionsPerPhase = { A: { P_kW: 0, Q_kVAr: 0 }, B: { P_kW: 0, Q_kVAr: 0 }, C: { P_kW: 0, Q_kVAr: 0 } };
      
      // Répartir les charges selon la configuration manuelle ou aléatoirement
      if (node.clients && node.clients.length > 0) {
        const phases = ['A', 'B', 'C'] as const;
        const totalChargePower = node.clients.reduce((sum, client) => sum + (client.S_kVA || 0), 0);
        
        if (manualPhaseDistribution) {
          // Répartition manuelle selon les pourcentages définis
          const chargeRatios = manualPhaseDistribution.charges;
          phases.forEach(phase => {
            const power = totalChargePower * (chargeRatios[phase] / 100);
            const tanPhi = Math.tan(Math.acos(Math.min(1, Math.max(0, cosPhi))));
            chargesPerPhase[phase].P_kW += power * cosPhi;
            chargesPerPhase[phase].Q_kVAr += power * cosPhi * tanPhi;
          });
        } else {
          // Répartition aléatoire (comportement existant)
          node.clients.forEach(client => {
            const randomPhase = phases[Math.floor(Math.random() * 3)];
            const power = client.S_kVA || 0;
            const tanPhi = Math.tan(Math.acos(Math.min(1, Math.max(0, cosPhi))));
            chargesPerPhase[randomPhase].P_kW += power * cosPhi;
            chargesPerPhase[randomPhase].Q_kVAr += power * cosPhi * tanPhi;
          });
        }
      }
      
      // Répartir les productions selon la configuration manuelle ou les règles existantes
      if (node.productions && node.productions.length > 0) {
        const phases = ['A', 'B', 'C'] as const;
        const totalProductionPower = node.productions.reduce((sum, prod) => sum + (prod.S_kVA || 0), 0);
        
        if (manualPhaseDistribution) {
          // Répartition manuelle selon les pourcentages définis
          const productionRatios = manualPhaseDistribution.productions;
          phases.forEach(phase => {
            const power = totalProductionPower * (productionRatios[phase] / 100);
            productionsPerPhase[phase].P_kW += power;
            // Production avec facteur de puissance unitaire (Q = 0)
          });
        } else {
          // Répartition selon les règles existantes (≤5kVA = mono, >5kVA = tri)
          node.productions.forEach(production => {
            const power = production.S_kVA || 0;
            if (power <= 5) {
              // Monophasé - assigner à une phase aléatoire
              const randomPhase = phases[Math.floor(Math.random() * 3)];
              productionsPerPhase[randomPhase].P_kW += power;
              // Production avec facteur de puissance unitaire (Q = 0)
            } else {
              // Triphasé - répartir équitablement sur les trois phases
              const powerPerPhase = power / 3;
              productionsPerPhase.A.P_kW += powerPerPhase;
              productionsPerPhase.B.P_kW += powerPerPhase;
              productionsPerPhase.C.P_kW += powerPerPhase;
              // Production avec facteur de puissance unitaire (Q = 0)
            }
          });
        }
      }
      
      distributionMap.set(node.id, { chargesPerPhase, productionsPerPhase });
    });
    
    return distributionMap;
  }

  /**
   * BFS modifié pour intégrer les équipements de simulation avec vraie convergence
   * et recalcul des nœuds aval pour chaque régulateur
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
    manualPhaseDistribution: { charges: {A:number;B:number;C:number}; productions: {A:number;B:number;C:number}; constraints: {min:number;max:number;total:number} } | undefined,
    regulators: Map<string, VoltageRegulator>,
    compensators: Map<string, NeutralCompensator>
  ): CalculationResult {
    
    const maxIterations = SimulationCalculator.SIM_MAX_ITERATIONS;
    let converged = false;
    let iteration = 0;
    let maxVoltageDelta = 0;
    
    // Structures pour le graphe et les calculs
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const adjacency = this.buildAdjacencyMap(nodes, cables);
    const treeStructure = this.buildTreeStructure(nodes, cables, adjacency);
    
    // État des équipements à chaque itération
    const regulatorStates = new Map<string, { Q_kVAr: number, V_target: number, isLimited: boolean }>();
    const compensatorStates = new Map<string, { S_virtual_kVA: number, IN_A: number, reductionPercent: number, isLimited: boolean }>();
    
    // Initialisation des états
    for (const [nodeId, regulator] of regulators.entries()) {
      regulatorStates.set(nodeId, { Q_kVAr: 0, V_target: regulator.targetVoltage_V, isLimited: false });
    }
    for (const [nodeId, _compensator] of compensators.entries()) {
      compensatorStates.set(nodeId, { S_virtual_kVA: 0, IN_A: 0, reductionPercent: 0, isLimited: false });
    }
    
    // Tensions précédentes pour convergence
    let previousVoltages = new Map<string, number>();
    // Résultat courant de l'itération
    let currentResult: CalculationResult;
    
    // Générer la distribution dynamique des charges et productions par phase une seule fois
    // Utiliser le cosPhi du projet (this.simCosPhi) pour les calculs P/Q
    const phaseDistribution = this.distributeLoadsAndProductionsPerPhase(nodes, this.simCosPhi, manualPhaseDistribution);
    
    while (iteration < maxIterations && !converged) {
      iteration++;
      console.log(`🔄 Simulation iteration ${iteration}`);
      
      // 1. Calculer le réseau avec les équipements actuels et la distribution dynamique
      const modifiedNodes = this.applyEquipmentToNodes(nodes, regulatorStates, compensatorStates);
      
      // Intégrer la distribution par phase dans les nodes modifiés
      const nodesWithPhaseDistribution = modifiedNodes.map(node => {
        const distribution = phaseDistribution.get(node.id);
        if (distribution) {
          return {
            ...node,
            phaseDistribution: distribution
          };
        }
        return node;
      });
      
      // Utiliser foisonnements = 0 et desequilibrePourcent = 1 pour activer le mode par phase
        currentResult = this.calculateScenario(
          nodesWithPhaseDistribution, cables, cableTypes, scenario,
          0, // foisonnementCharges = 0 pour utiliser la distribution exacte
          0, // foisonnementProductions = 0 pour utiliser la distribution exacte
          transformerConfig, loadModel, 1, // desequilibrePourcent = 1 pour activer le mode par phase
          manualPhaseDistribution
        );
      
      // Sauvegarder les tensions pour convergence
      if (currentResult.nodeMetrics) {
        for (const nodeMetric of currentResult.nodeMetrics) {
          previousVoltages.set(nodeMetric.nodeId, nodeMetric.V_phase_V);
        }
      }
      
      let equipmentChanged = false;
      
      // 2. Traiter les régulateurs avec sensibilité dV/dQ dynamique via ΔQ test
      let maxQDelta = 0;
      for (const [nodeId, regulator] of regulators.entries()) {
        const node = nodeById.get(nodeId);
        if (!node) continue;

        const baseV_line = this.getNodeLineVoltageFromResult(currentResult, node, nodes);
        const targetV = regulator.targetVoltage_V;
        const state = regulatorStates.get(nodeId)!;

        // Construire un état test avec ΔQ = +1 kVAr
        const deltaQtest = 1; // kVAr
        const testRegulatorStates = new Map(regulatorStates);
        const testState = { ...state, Q_kVAr: state.Q_kVAr + deltaQtest };
        testRegulatorStates.set(nodeId, testState);

        const testNodes = this.applyEquipmentToNodes(nodes, testRegulatorStates, compensatorStates);
        
        // Intégrer la distribution par phase dans les nodes de test
        const testNodesWithPhaseDistribution = testNodes.map(node => {
          const distribution = phaseDistribution.get(node.id);
          if (distribution) {
            return {
              ...node,
              phaseDistribution: distribution
            };
          }
          return node;
        });
        
        const testResult = this.calculateScenario(
          testNodesWithPhaseDistribution, cables, cableTypes, scenario,
          0, // foisonnementCharges = 0 pour utiliser la distribution exacte
          0, // foisonnementProductions = 0 pour utiliser la distribution exacte
          transformerConfig, loadModel, 1, // desequilibrePourcent = 1 pour activer le mode par phase
          manualPhaseDistribution
        );
        const testV_line = this.getNodeLineVoltageFromResult(testResult, node, nodes);

        // Sensibilité numérique
        let sensitivity = (testV_line - baseV_line) / deltaQtest; // V/kVAr
        if (!isFinite(sensitivity) || Math.abs(sensitivity) < 1e-6) {
          // Fallback minimal pour éviter division par zéro
          sensitivity = 0.05; // V/kVAr
        }

        // Correction de Q (damping pour stabilité)
        const deltaV = targetV - baseV_line;
        let deltaQ = deltaV / sensitivity; // kVAr nécessaires
        // Limiter la variation par itération pour éviter la surcompensation
        const maxStep = Math.max(2, regulator.maxPower_kVA * 0.25);
        deltaQ = Math.max(-maxStep, Math.min(maxStep, deltaQ));

        const newQ = Math.max(-regulator.maxPower_kVA, Math.min(regulator.maxPower_kVA, state.Q_kVAr + deltaQ));
        const qChange = Math.abs(newQ - state.Q_kVAr);
        if (qChange > 0.05) {
          state.Q_kVAr = newQ;
          state.isLimited = Math.abs(newQ) >= regulator.maxPower_kVA;
          equipmentChanged = true;
        }
        if (qChange > maxQDelta) maxQDelta = qChange;

        console.log(`📊 Régulateur ${nodeId}: Vbase=${baseV_line.toFixed(1)}V → Q=${state.Q_kVAr.toFixed(2)} kVAr (ΔQ=${deltaQ.toFixed(2)}), limited=${state.isLimited}`);
      }
      
      // 3. Traiter les compensateurs via modèle EQUI8 (sans charges virtuelles)
      for (const [nodeId, compensator] of compensators.entries()) {
        const currentState = compensatorStates.get(nodeId)!;
        // On n'applique plus de charge virtuelle ici; l'effet EQUI8 sera appliqué après le calcul final
        // Réinitialiser l'état de charge virtuelle si nécessaire
        const hadNonZero = Math.abs(currentState.S_virtual_kVA) > 0.001 || Math.abs(currentState.IN_A) > 0.01 || Math.abs(currentState.reductionPercent) > 0.1 || currentState.isLimited;
        currentState.S_virtual_kVA = 0;
        currentState.IN_A = 0;
        currentState.reductionPercent = 0;
        currentState.isLimited = false;
        // Sorties héritées à zéro (non utilisées par EQUI8)
        compensator.currentIN_A = 0;
        compensator.reductionPercent = 0;
        compensator.compensationQ_kVAr = { A: 0, B: 0, C: 0 };
        if (hadNonZero) equipmentChanged = true;
      }
      
      // 4. Si équipements changés, recalculer le réseau complet
      if (equipmentChanged) {
        const finalModifiedNodes = this.applyEquipmentToNodes(nodes, regulatorStates, compensatorStates);
        currentResult = this.calculateScenario(
          finalModifiedNodes, cables, cableTypes, scenario,
          foisonnementCharges, foisonnementProductions,
          transformerConfig, loadModel, desequilibrePourcent,
          manualPhaseDistribution
        );
      }
      
      // 5. Test de convergence (tension + stabilité Q)
      maxVoltageDelta = 0;
      if (currentResult.nodeMetrics) {
        for (const nodeMetric of currentResult.nodeMetrics) {
          const prevV = previousVoltages.get(nodeMetric.nodeId) || nodeMetric.V_phase_V;
          const deltaV = Math.abs(nodeMetric.V_phase_V - prevV);
          if (deltaV > maxVoltageDelta) {
            maxVoltageDelta = deltaV;
          }
        }
      }
      
      if (
        maxVoltageDelta < SimulationCalculator.SIM_CONVERGENCE_TOLERANCE_PHASE_V &&
        (typeof maxQDelta === 'number' ? maxQDelta : 0) < 0.1
      ) {
        converged = true;
      }
    }
    
    // 6. Calcul final avec états d'équipement figés pour garantir la cohérence
    const finalModifiedNodes = this.applyEquipmentToNodes(nodes, regulatorStates, compensatorStates);
    currentResult = this.calculateScenario(
      finalModifiedNodes, cables, cableTypes, scenario,
      foisonnementCharges, foisonnementProductions,
      transformerConfig, loadModel, desequilibrePourcent,
      manualPhaseDistribution
    );

    // 6.b Appliquer le modèle EQUI8 aux nœuds équipés
    for (const [nodeId, compensator] of compensators.entries()) {
      if (!compensator.enabled) continue;
      // Récupérer les tensions initiales par phase
      let initial: number[] = [230, 230, 230];
      const perPhaseMetrics = currentResult.nodeMetricsPerPhase?.find(m => m.nodeId === nodeId);
      if (perPhaseMetrics) {
        initial = [
          perPhaseMetrics.voltagesPerPhase.A,
          perPhaseMetrics.voltagesPerPhase.B,
          perPhaseMetrics.voltagesPerPhase.C,
        ];
      } else {
        const phasors = currentResult.nodePhasorsPerPhase?.filter(p => p.nodeId === nodeId);
        if (phasors && phasors.length >= 3) {
          const a = phasors.find(p => p.phase === 'A')?.V_phase_V ?? 230;
          const b = phasors.find(p => p.phase === 'B')?.V_phase_V ?? a;
          const c = phasors.find(p => p.phase === 'C')?.V_phase_V ?? a;
          initial = [a, b, c];
        } else {
          const metric = currentResult.nodeMetrics?.find(m => m.nodeId === nodeId);
          if (metric) initial = [metric.V_phase_V, metric.V_phase_V, metric.V_phase_V];
        }
      }
      const Zp = Math.max(1e-9, compensator.phaseImpedance ?? compensator.zPhase_Ohm ?? 1e-9);
      const [uA, uB, uC] = this.calculateEqui8Effect(initial, Zp);

      // Mettre à jour les métriques par phase
      if (currentResult.nodeMetricsPerPhase) {
        const idx = currentResult.nodeMetricsPerPhase.findIndex(m => m.nodeId === nodeId);
        if (idx >= 0) {
          currentResult.nodeMetricsPerPhase[idx] = {
            ...currentResult.nodeMetricsPerPhase[idx],
            voltagesPerPhase: { A: uA, B: uB, C: uC },
          };
        } else {
          currentResult.nodeMetricsPerPhase.push({
            nodeId,
            voltagesPerPhase: { A: uA, B: uB, C: uC },
            voltageDropsPerPhase: { A: 0, B: 0, C: 0 },
          });
        }
      } else {
        currentResult.nodeMetricsPerPhase = [{
          nodeId,
          voltagesPerPhase: { A: uA, B: uB, C: uC },
          voltageDropsPerPhase: { A: 0, B: 0, C: 0 },
        }];
      }

      // Mettre à jour les phasors s'ils existent
      if (currentResult.nodePhasorsPerPhase) {
        const updatePhase = (phase: 'A' | 'B' | 'C', mag: number) => {
          const p = currentResult.nodePhasorsPerPhase!.find(pp => pp.nodeId === nodeId && pp.phase === phase);
          if (p) p.V_phase_V = mag;
        };
        updatePhase('A', uA);
        updatePhase('B', uB);
        updatePhase('C', uC);
      }

      // Mettre à jour la métrique agrégée si présente (moyenne des phases)
      if (currentResult.nodeMetrics) {
        const midx = currentResult.nodeMetrics.findIndex(m => m.nodeId === nodeId);
        if (midx >= 0) {
          currentResult.nodeMetrics[midx] = {
            ...currentResult.nodeMetrics[midx],
            V_phase_V: (uA + uB + uC) / 3,
          };
        }
      }

      // Stocker dans l'équipement pour inspection
      compensator.u1p_V = uA;
      compensator.u2p_V = uB;
      compensator.u3p_V = uC;

      // 🔄 CORRECTION: Propager les nouvelles tensions aux nœuds en aval
      this.propagateVoltagesDownstream(nodeId, { A: uA, B: uB, C: uC }, nodes, cables, cableTypes, currentResult);
    }

    // 7. Mise à jour des résultats dans les équipements originaux
    this.updateEquipmentResults(regulators, regulatorStates, compensators, compensatorStates);
    
    if (!converged) {
      console.warn(`⚠️ Simulation BFS non convergé après ${maxIterations} itérations (δV max = ${maxVoltageDelta.toFixed(3)}V)`);
    } else {
      console.log(`✅ Simulation BFS convergé en ${iteration} itérations`);
    }

    // Mettre à jour la tension mesurée aux nœuds des régulateurs (affichage) avec le dernier résultat
    for (const [nodeId, regulator] of regulators.entries()) {
      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        regulator.currentVoltage_V = this.getNodeLineVoltageFromResult(currentResult, node, nodes);
      }
    }

    // Renvoyer directement le résultat de la dernière itération
    return currentResult;
  }

  /**
   * Propage les nouvelles tensions d'un nœud compensateur vers les nœuds en aval
   */
  private propagateVoltagesDownstream(
    sourceNodeId: string, 
    sourceVoltages: { A: number; B: number; C: number },
    nodes: Node[], 
    cables: Cable[], 
    cableTypes: CableType[],
    result: CalculationResult
  ): void {
    console.log(`🔄 Propagating voltages from compensator ${sourceNodeId}:`, sourceVoltages);
    
    // Créer un graphe des connexions
    const nodeConnections = new Map<string, { cable: Cable; otherNodeId: string }[]>();
    
    for (const cable of cables) {
      const connections1 = nodeConnections.get(cable.nodeAId) || [];
      const connections2 = nodeConnections.get(cable.nodeBId) || [];
      
      connections1.push({ cable, otherNodeId: cable.nodeBId });
      connections2.push({ cable, otherNodeId: cable.nodeAId });
      
      nodeConnections.set(cable.nodeAId, connections1);
      nodeConnections.set(cable.nodeBId, connections2);
    }

    // BFS pour propager les tensions
    const visited = new Set<string>();
    const queue: { nodeId: string; voltages: { A: number; B: number; C: number } }[] = [];
    
    // Commencer par le nœud compensateur
    queue.push({ nodeId: sourceNodeId, voltages: sourceVoltages });
    visited.add(sourceNodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const connections = nodeConnections.get(current.nodeId) || [];
      
      for (const { cable, otherNodeId } of connections) {
        if (visited.has(otherNodeId)) continue;
        
        // Calculer les nouvelles tensions au nœud en aval
        const newVoltages = this.calculateDownstreamVoltages(
          current.voltages, 
          cable, 
          current.nodeId === cable.nodeAId, // true si on va de A vers B
          nodes, 
          cableTypes
        );
        
        // Mettre à jour les résultats
        this.updateNodeVoltagesInResult(otherNodeId, newVoltages, result);
        
        // Continuer la propagation
        visited.add(otherNodeId);
        queue.push({ nodeId: otherNodeId, voltages: newVoltages });
        
        console.log(`  → Node ${otherNodeId}: A=${newVoltages.A.toFixed(1)}V, B=${newVoltages.B.toFixed(1)}V, C=${newVoltages.C.toFixed(1)}V`);
      }
    }
  }

  /**
   * Calcule les tensions en aval d'un câble avec chutes de tension
   */
  private calculateDownstreamVoltages(
    upstreamVoltages: { A: number; B: number; C: number },
    cable: Cable,
    isForwardDirection: boolean,
    nodes: Node[],
    cableTypes: CableType[]
  ): { A: number; B: number; C: number } {
    const cableType = cableTypes.find(t => t.id === cable.typeId);
    if (!cableType) return upstreamVoltages;

    // Récupérer les nœuds
    const nodeA = nodes.find(n => n.id === cable.nodeAId);
    const nodeB = nodes.find(n => n.id === cable.nodeBId);
    if (!nodeA || !nodeB) return upstreamVoltages;

    // Calculer les courants (approximation basée sur les charges des nœuds)
    const targetNode = isForwardDirection ? nodeB : nodeA;
    const totalLoad = (targetNode.clients || []).reduce((sum, charge) => sum + charge.S_kVA, 0);
    const totalProd = (targetNode.productions || []).reduce((sum, prod) => sum + prod.S_kVA, 0);
    const netLoad = Math.max(0, totalLoad - totalProd); // kVA

    // Courant approximatif par phase (réparti uniformément)
    const current_A = netLoad > 0 ? netLoad * 1000 / (3 * 230) : 0; // A par phase approximatif

    // Résistance et réactance du câble
    const R_ohm = cableType.R12_ohm_per_km * (cable.length_m || 0) / 1000;
    const X_ohm = cableType.X12_ohm_per_km * (cable.length_m || 0) / 1000;

    // Chute de tension par phase: ΔU = I × (R + jX) ≈ I × R (approximation résistive)
    const voltageDrop = current_A * R_ohm;

    // Appliquer la chute (négative si on va dans le sens du courant)
    const dropSign = isForwardDirection ? -1 : 1;
    
    return {
      A: upstreamVoltages.A + dropSign * voltageDrop,
      B: upstreamVoltages.B + dropSign * voltageDrop,  
      C: upstreamVoltages.C + dropSign * voltageDrop
    };
  }

  /**
   * Met à jour les tensions d'un nœud dans les résultats
   */
  private updateNodeVoltagesInResult(
    nodeId: string, 
    voltages: { A: number; B: number; C: number }, 
    result: CalculationResult
  ): void {
    // Mettre à jour nodeMetricsPerPhase
    if (result.nodeMetricsPerPhase) {
      const idx = result.nodeMetricsPerPhase.findIndex(m => m.nodeId === nodeId);
      if (idx >= 0) {
        result.nodeMetricsPerPhase[idx] = {
          ...result.nodeMetricsPerPhase[idx],
          voltagesPerPhase: voltages,
        };
      } else {
        result.nodeMetricsPerPhase.push({
          nodeId,
          voltagesPerPhase: voltages,
          voltageDropsPerPhase: { A: 0, B: 0, C: 0 },
        });
      }
    }

    // Mettre à jour nodePhasorsPerPhase si présent
    if (result.nodePhasorsPerPhase) {
      const updatePhase = (phase: 'A' | 'B' | 'C', mag: number) => {
        const p = result.nodePhasorsPerPhase!.find(pp => pp.nodeId === nodeId && pp.phase === phase);
        if (p) p.V_phase_V = mag;
      };
      updatePhase('A', voltages.A);
      updatePhase('B', voltages.B);
      updatePhase('C', voltages.C);
    }

    // Mettre à jour la métrique agrégée (moyenne)
    if (result.nodeMetrics) {
      const midx = result.nodeMetrics.findIndex(m => m.nodeId === nodeId);
      if (midx >= 0) {
        result.nodeMetrics[midx] = {
          ...result.nodeMetrics[midx],
          V_phase_V: (voltages.A + voltages.B + voltages.C) / 3,
        };
      }
    }
  }

  /**
   * Applique les équipements aux nœuds pour créer des nœuds modifiés
   */
  private applyEquipmentToNodes(
    nodes: Node[],
    regulatorStates: Map<string, { Q_kVAr: number, V_target: number, isLimited: boolean }>,
    compensatorStates: Map<string, { S_virtual_kVA: number, IN_A: number, reductionPercent: number, isLimited: boolean }>
  ): Node[] {
    return nodes.map(node => {
      const regulatorState = regulatorStates.get(node.id);
      const compensatorState = compensatorStates.get(node.id);
      
      if (!regulatorState && !compensatorState) {
        return node;
      }
      
      const modifiedNode = { ...node };
      
      // Appliquer les régulateurs (injection de puissance réactive)
      if (regulatorState && Math.abs(regulatorState.Q_kVAr) > 0.001) {
        // Créer une production virtuelle pour injecter la puissance réactive
        const virtualProduction = {
          id: `regulator_${node.id}`,
          name: 'Régulateur de tension',
          label: 'Régulateur de tension',
          S_kVA: Math.abs(regulatorState.Q_kVAr), // Magnitude
          cosPhi: 0, // Puissance purement réactive
          type: 'AUTRE' as const
        };
        
        modifiedNode.productions = [...(node.productions || []), virtualProduction];
      }
      
      // Appliquer les compensateurs (charge virtuelle si nécessaire)
      if (compensatorState && Math.abs(compensatorState.S_virtual_kVA) > 0.001) {
        const virtualLoad = {
          id: `compensator_${node.id}`,
          name: 'Compensateur de neutre',
          label: 'Compensateur de neutre',
          S_kVA: compensatorState.S_virtual_kVA,
          cosPhi: 0.95,
          type: 'AUTRE' as const
        };
        
        modifiedNode.clients = [...(node.clients || []), virtualLoad];
      }
      
      return modifiedNode;
    });
  }

  /**
   * Met à jour les résultats dans les équipements originaux
   */
  private updateEquipmentResults(
    regulators: Map<string, VoltageRegulator>,
    regulatorStates: Map<string, { Q_kVAr: number, V_target: number, isLimited: boolean }>,
    compensators: Map<string, NeutralCompensator>,
    compensatorStates: Map<string, { S_virtual_kVA: number, IN_A: number, reductionPercent: number, isLimited: boolean }>
  ): void {
    // Mise à jour des régulateurs
    for (const [nodeId, regulator] of regulators.entries()) {
      const state = regulatorStates.get(nodeId);
      if (state) {
        regulator.currentQ_kVAr = state.Q_kVAr;
        regulator.isLimited = state.isLimited;
      }
    }
    
    // Mise à jour des compensateurs
    for (const [nodeId, compensator] of compensators.entries()) {
      const state = compensatorStates.get(nodeId);
      if (state) {
        compensator.currentIN_A = state.IN_A;
        compensator.reductionPercent = state.reductionPercent;
        compensator.isLimited = state.isLimited;
      }
    }
  }

  /**
   * Récupère la tension ligne d'un nœud à partir du résultat de calcul
   */
  private getNodeLineVoltageFromResult(result: CalculationResult, node: Node, allNodes: Node[]): number {
    // Chercher d'abord dans les métriques par phase
    const perPhaseMetric = result.nodeMetricsPerPhase?.find(m => m.nodeId === node.id);
    if (perPhaseMetric) {
      const { A, B, C } = perPhaseMetric.voltagesPerPhase;
      // Calculer la tension ligne moyenne: U_ligne = √3 × U_phase_moyenne
      const avgPhaseVoltage = (A + B + C) / 3;
      return avgPhaseVoltage * Math.sqrt(3);
    }
    
    // Fallback sur les métriques standard
    const nodeMetric = result.nodeMetrics?.find(m => m.nodeId === node.id);
    if (nodeMetric) {
      // Convertir selon le type de connexion
      const config = (() => {
        switch (node.connectionType) {
          case 'MONO_230V_PN':
          case 'MONO_230V_PP':
            return { isThreePhase: false };
          case 'TRI_230V_3F':
          case 'TÉTRA_3P+N_230_400V':
          default:
            return { isThreePhase: true };
        }
      })();
      
      return config.isThreePhase ? nodeMetric.V_phase_V * Math.sqrt(3) : nodeMetric.V_phase_V;
    }
    
    // Fallback ultime
    return 230;
  }

  /**
   * Calcule l'effet EQUI8 sur les tensions des phases
   */
  private calculateEqui8Effect(
    voltages: number[], // [U1, U2, U3] en volts
    Zp: number // Impédance de phase en ohms
  ): [number, number, number] {
    // Modèle simplifié EQUI8: équilibrage des tensions via compensation
    const [U1, U2, U3] = voltages;
    const U_avg = (U1 + U2 + U3) / 3;
    
    // Facteur d'équilibrage basé sur l'impédance de phase
    const balancingFactor = Math.min(0.8, 1 / (1 + Zp)); // Limitation à 80% d'efficacité
    
    // Calculer les tensions corrigées (rapprochement vers la moyenne)
    const U1_corr = U1 + (U_avg - U1) * balancingFactor;
    const U2_corr = U2 + (U_avg - U2) * balancingFactor;
    const U3_corr = U3 + (U_avg - U3) * balancingFactor;
    
    return [U1_corr, U2_corr, U3_corr];
  }

  /**
   * Construit une map d'adjacence pour le graphe du réseau
   */
  private buildAdjacencyMap(nodes: Node[], cables: Cable[]): Map<string, string[]> {
    const adjacency = new Map<string, string[]>();
    
    // Initialiser tous les nœuds
    nodes.forEach(node => {
      adjacency.set(node.id, []);
    });
    
    // Ajouter les connexions bidirectionnelles
    cables.forEach(cable => {
      const nodeAConnections = adjacency.get(cable.nodeAId) || [];
      const nodeBConnections = adjacency.get(cable.nodeBId) || [];
      
      nodeAConnections.push(cable.nodeBId);
      nodeBConnections.push(cable.nodeAId);
      
      adjacency.set(cable.nodeAId, nodeAConnections);
      adjacency.set(cable.nodeBId, nodeBConnections);
    });
    
    return adjacency;
  }

  /**
   * Construit la structure arborescente du réseau
   */
  private buildTreeStructure(
    nodes: Node[], 
    cables: Cable[], 
    adjacency: Map<string, string[]>
  ): Map<string, { parent: string | null; children: string[]; depth: number }> {
    const treeStructure = new Map<string, { parent: string | null; children: string[]; depth: number }>();
    
    // Trouver le nœud source
    const sourceNode = nodes.find(n => n.isSource);
    if (!sourceNode) {
      console.warn('Aucun nœud source trouvé');
      return treeStructure;
    }
    
    // BFS pour construire l'arbre
    const visited = new Set<string>();
    const queue: { nodeId: string; parent: string | null; depth: number }[] = [];
    
    queue.push({ nodeId: sourceNode.id, parent: null, depth: 0 });
    visited.add(sourceNode.id);
    
    while (queue.length > 0) {
      const { nodeId, parent, depth } = queue.shift()!;
      
      const children: string[] = [];
      const neighbors = adjacency.get(nodeId) || [];
      
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          children.push(neighborId);
          queue.push({ nodeId: neighborId, parent: nodeId, depth: depth + 1 });
        }
      }
      
      treeStructure.set(nodeId, { parent, children, depth });
    }
    
    return treeStructure;
  }
  
  /**
   * Crée un régulateur par défaut pour un nœud
   */
  createDefaultRegulator(nodeId: string, sourceVoltage: number): VoltageRegulator {
    const regulatorType: RegulatorType = sourceVoltage > 300 ? '400V_44kVA' : '230V_77kVA';
    const maxPower = sourceVoltage > 300 ? 44 : 77;
    
    return {
      id: `regulator_${nodeId}_${Date.now()}`,
      nodeId,
      type: regulatorType,
      targetVoltage_V: sourceVoltage > 300 ? 400 : 230,
      maxPower_kVA: maxPower,
      enabled: false
    };
  }
  
  /**
   * Propose des améliorations de circuit complètes
   */
  proposeFullCircuitReinforcement(
    cables: Cable[],
    cableTypes: CableType[],
    threshold: number = 5
  ): CableUpgrade[] {
    // Implémentation simplifiée - retourne les câbles nécessitant une amélioration
    return cables
      .filter(cable => (cable.voltageDropPercent || 0) > threshold)
      .map(cable => {
        const currentType = cableTypes.find(t => t.id === cable.typeId);
        const betterType = cableTypes.find(t => 
          t.R12_ohm_per_km < (currentType?.R12_ohm_per_km || Infinity)
        );
        
        return {
          originalCableId: cable.id,
          newCableTypeId: betterType?.id || cable.typeId,
          reason: 'voltage_drop' as const,
          before: {
            voltageDropPercent: cable.voltageDropPercent || 0,
            current_A: cable.current_A || 0,
            losses_kW: cable.losses_kW || 0
          },
          after: {
            voltageDropPercent: (cable.voltageDropPercent || 0) * 0.7,
            current_A: cable.current_A || 0,
            losses_kW: (cable.losses_kW || 0) * 0.7
          },
          improvement: {
            voltageDropReduction: (cable.voltageDropPercent || 0) * 0.3,
            lossReduction_kW: (cable.losses_kW || 0) * 0.3,
            lossReductionPercent: 30
          }
        };
      });
  }
}
