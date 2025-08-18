import { NetworkNode, Cable, CableType, NetworkConfig, CalculationScenario, CalculationResult } from '@/types/electrical';

export class ElectricalCalculations {
  private config: NetworkConfig;

  constructor(config: NetworkConfig) {
    this.config = config;
  }

  /**
   * Calculate current intensity for a given power
   * I = (S × 1000) / (√3 × U_n)
   */
  calculateCurrent(power: number): number {
    const voltage = this.config.voltage;
    return (power * 1000) / (Math.sqrt(3) * voltage);
  }

  /**
   * Calculate voltage drop for a cable section
   * ΔU = √3 × I × (R × cosφ + X × sinφ) × L
   */
  calculateVoltageDrop(current: number, cable: Cable, cableType: CableType): number {
    const cosPhi = this.config.cosPhi;
    const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
    const length = cable.length / 1000; // Convert meters to kilometers
    
    const impedance = (cableType.r12 * cosPhi + cableType.x12 * sinPhi) * length;
    return Math.sqrt(3) * current * impedance;
  }

  /**
   * Calculate voltage drop percentage
   * ΔU% = (ΔU / U_n) × 100
   */
  calculateVoltageDropPercent(voltageDrop: number): number {
    return (voltageDrop / this.config.voltage) * 100;
  }

  /**
   * Calculate power losses
   * Pertes kW = I² × R × L
   */
  calculateLosses(current: number, cableType: CableType, length: number): number {
    const lengthKm = length / 1000;
    return Math.pow(current, 2) * cableType.r12 * lengthKm / 1000; // Convert to kW
  }

  /**
   * Calculate total power for a node based on scenario
   */
  calculateNodePower(node: NetworkNode, scenario: CalculationScenario): number {
    const totalLoads = node.loads.reduce((sum, load) => sum + load.power, 0);
    const totalProductions = node.productions.reduce((sum, prod) => sum + prod.power, 0);

    switch (scenario) {
      case 'consumption':
        return totalLoads;
      case 'production':
        return totalProductions;
      case 'mixed':
        return totalLoads - totalProductions; // Can be negative for net injection
    }
  }

  /**
   * Get compliance status based on EN 50160 (±10%)
   */
  getComplianceStatus(voltageDropPercent: number): 'normal' | 'warning' | 'critical' {
    const absVoltageDropPercent = Math.abs(voltageDropPercent);
    
    if (absVoltageDropPercent <= 8) return 'normal';
    if (absVoltageDropPercent <= 10) return 'warning';
    return 'critical';
  }

  /**
   * Calculate cumulative power at each node for a given path
   */
  calculateCumulativePowers(
    nodes: NetworkNode[], 
    cables: Cable[], 
    scenario: CalculationScenario
  ): Map<string, number> {
    const powers = new Map<string, number>();
    
    // Initialize with node powers
    nodes.forEach(node => {
      powers.set(node.id, this.calculateNodePower(node, scenario));
    });

    // TODO: Implement proper network traversal for cumulative calculations
    // This is a simplified version - in reality, we need to traverse the network
    // from the source to calculate cumulative powers correctly
    
    return powers;
  }

  /**
   * Perform complete calculation for a scenario
   */
  calculateScenario(
    nodes: NetworkNode[],
    cables: Cable[],
    cableTypes: Map<string, CableType>,
    scenario: CalculationScenario
  ): CalculationResult {
    const calculatedCables: Cable[] = [];
    let totalLoads = 0;
    let totalProductions = 0;
    let globalLosses = 0;
    let maxVoltageDrop = 0;

    // Calculate totals
    nodes.forEach(node => {
      totalLoads += node.loads.reduce((sum, load) => sum + load.power, 0);
      totalProductions += node.productions.reduce((sum, prod) => sum + prod.power, 0);
    });

    // Calculate for each cable
    cables.forEach(cable => {
      const cableType = cableTypes.get(cable.type.id);
      if (!cableType) return;

      // Simplified calculation - in reality we need proper network analysis
      const fromNode = nodes.find(n => n.id === cable.fromNodeId);
      const toNode = nodes.find(n => n.id === cable.toNodeId);
      
      if (!fromNode || !toNode) return;

      const nodePower = this.calculateNodePower(toNode, scenario);
      const current = Math.abs(this.calculateCurrent(nodePower));
      const voltageDrop = this.calculateVoltageDrop(current, cable, cableType);
      const voltageDropPercent = this.calculateVoltageDropPercent(voltageDrop);
      const losses = this.calculateLosses(current, cableType, cable.length);

      calculatedCables.push({
        ...cable,
        current,
        voltageDrop,
        voltageDropPercent,
        losses
      });

      globalLosses += losses;
      maxVoltageDrop = Math.max(maxVoltageDrop, Math.abs(voltageDropPercent));
    });

    const compliance = this.getComplianceStatus(maxVoltageDrop);

    return {
      scenario,
      cables: calculatedCables,
      totalLoads,
      totalProductions,
      globalLosses,
      maxVoltageDrop,
      compliance
    };
  }
}