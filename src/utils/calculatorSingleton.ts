import { ElectricalCalculator } from './electricalCalculations';
import { SimulationCalculator } from './simulationCalculator';

/**
 * Singleton Calculator Manager
 * Reduces memory usage by reusing calculator instances
 */
class CalculatorManager {
  private electricalCalculator: ElectricalCalculator | null = null;
  private simulationCalculator: SimulationCalculator | null = null;

  getElectricalCalculator(cosPhi: number): ElectricalCalculator {
    if (!this.electricalCalculator || this.electricalCalculator['cosPhi'] !== cosPhi) {
      this.electricalCalculator = new ElectricalCalculator(cosPhi);
    }
    return this.electricalCalculator;
  }

  getSimulationCalculator(cosPhi: number): SimulationCalculator {
    if (!this.simulationCalculator || this.simulationCalculator['cosPhi'] !== cosPhi) {
      this.simulationCalculator = new SimulationCalculator(cosPhi);
    }
    return this.simulationCalculator;
  }

  reset(): void {
    this.electricalCalculator = null;
    this.simulationCalculator = null;
  }
}

export const calculatorManager = new CalculatorManager();