import { ConnectionType, Node, Cable, CableType, CalculationScenario, CalculationResult } from '@/types/network';

export class ElectricalCalculator {
  private cosPhi: number;

  constructor(cosPhi: number = 0.95) {
    this.cosPhi = cosPhi;
  }

  /**
   * Calcul de l'intensité selon le type de connexion
   */
  calculateCurrent(S_kVA: number, connectionType: ConnectionType): number {
    const U = this.getVoltage(connectionType);
    
    switch (connectionType) {
      case 'MONO_230V_PP':
      case 'MONO_230V_PN':
        return (S_kVA * 1000) / (U * this.cosPhi);
      
      case 'TRI_230V_3F':
      case 'TÉTRA_3P+N_230_400V':
        return (S_kVA * 1000) / (Math.sqrt(3) * U * this.cosPhi);
    }
  }

  /**
   * Calcul de la chute de tension selon le type de connexion
   */
  calculateVoltageDrop(
    current_A: number, 
    connectionType: ConnectionType, 
    cableType: CableType, 
    length_m: number
  ): number {
    const rho = cableType.R12_ohm_per_km / 1000; // Conversion en Ω/m
    const L = length_m;
    
    switch (connectionType) {
      case 'MONO_230V_PP':
      case 'MONO_230V_PN':
        return (2 * rho * L * current_A * this.cosPhi); // Simplifiée pour ρ en Ω/m
      
      case 'TRI_230V_3F':
      case 'TÉTRA_3P+N_230_400V':
        return (Math.sqrt(3) * rho * L * current_A * this.cosPhi); // Simplifiée pour ρ en Ω/m
    }
  }

  /**
   * Calcul du pourcentage de chute de tension
   */
  calculateVoltageDropPercent(voltageDrop_V: number, connectionType: ConnectionType): number {
    const U = this.getVoltage(connectionType);
    return (voltageDrop_V / U) * 100;
  }

  /**
   * Calcul des pertes en kW
   */
  calculateLosses(current_A: number, cableType: CableType, length_m: number): number {
    const R_ohm_per_m = cableType.R12_ohm_per_km / 1000;
    return Math.pow(current_A, 2) * R_ohm_per_m * length_m / 1000; // en kW
  }

  /**
   * Obtenir la tension nominale selon le type de connexion
   */
  private getVoltage(connectionType: ConnectionType): number {
    switch (connectionType) {
      case 'MONO_230V_PP':
      case 'TRI_230V_3F':
      case 'MONO_230V_PN':
        return 230;
      case 'TÉTRA_3P+N_230_400V':
        return 400;
    }
  }

  /**
   * Calculer la puissance totale d'un nœud selon le scénario
   */
  calculateNodePower(node: Node, scenario: CalculationScenario): number {
    const totalLoads = node.clients.reduce((sum, client) => sum + client.S_kVA, 0);
    const totalProductions = node.productions.reduce((sum, prod) => sum + prod.S_kVA, 0);

    switch (scenario) {
      case 'PRÉLÈVEMENT':
        return totalLoads;
      case 'PRODUCTION':
        return totalProductions;
      case 'MIXTE':
        return totalLoads - totalProductions; // Peut être négatif pour injection nette
    }
  }

  /**
   * Calculer la distance géodésique entre deux points
   */
  static calculateGeodeticDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000; // Rayon de la Terre en mètres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }

  /**
   * Calculer la longueur totale d'un câble à partir de ses coordonnées
   */
  static calculateCableLength(coordinates: { lat: number; lng: number; }[]): number {
    if (coordinates.length < 2) return 0;
    
    let totalLength = 0;
    for (let i = 1; i < coordinates.length; i++) {
      totalLength += this.calculateGeodeticDistance(
        coordinates[i-1].lat, coordinates[i-1].lng,
        coordinates[i].lat, coordinates[i].lng
      );
    }
    return totalLength;
  }

  /**
   * Déterminer le statut de conformité selon EN 50160
   */
  getComplianceStatus(voltageDropPercent: number): 'normal' | 'warning' | 'critical' {
    const absPercent = Math.abs(voltageDropPercent);
    if (absPercent < 8) return 'normal';
    if (absPercent < 10) return 'warning';
    return 'critical';
  }

  /**
   * Calculer un scénario complet
   */
  calculateScenario(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario
  ): CalculationResult {
    const cableTypeMap = new Map(cableTypes.map(type => [type.id, type]));
    const calculatedCables: Cable[] = [];
    let totalLoads = 0;
    let totalProductions = 0;
    let globalLosses = 0;
    let maxVoltageDropPercent = 0;

    // Calculer les totaux
    nodes.forEach(node => {
      totalLoads += node.clients.reduce((sum, client) => sum + client.S_kVA, 0);
      totalProductions += node.productions.reduce((sum, prod) => sum + prod.S_kVA, 0);
    });

    // Calculer pour chaque câble
    cables.forEach(cable => {
      const cableType = cableTypeMap.get(cable.typeId);
      if (!cableType) return;

      const nodeB = nodes.find(n => n.id === cable.nodeBId);
      if (!nodeB) return;

      // Calculer la longueur si pas déjà calculée
      const length = cable.length_m || ElectricalCalculator.calculateCableLength(cable.coordinates);
      
      const nodePower = this.calculateNodePower(nodeB, scenario);
      const current = Math.abs(this.calculateCurrent(nodePower, nodeB.connectionType));
      const voltageDrop = this.calculateVoltageDrop(current, nodeB.connectionType, cableType, length);
      const voltageDropPercent = this.calculateVoltageDropPercent(voltageDrop, nodeB.connectionType);
      const losses = this.calculateLosses(current, cableType, length);

      calculatedCables.push({
        ...cable,
        length_m: length,
        current_A: current,
        voltageDrop_V: voltageDrop,
        voltageDropPercent,
        losses_kW: losses
      });

      globalLosses += losses;
      maxVoltageDropPercent = Math.max(maxVoltageDropPercent, Math.abs(voltageDropPercent));
    });

    const compliance = this.getComplianceStatus(maxVoltageDropPercent);

    return {
      scenario,
      cables: calculatedCables,
      totalLoads_kVA: totalLoads,
      totalProductions_kVA: totalProductions,
      globalLosses_kW: globalLosses,
      maxVoltageDropPercent,
      compliance
    };
  }
}