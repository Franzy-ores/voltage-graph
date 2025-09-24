import { Node, Project, TransformerConfig, TransformerRating } from '@/types/network';
import { ElectricalCalculator } from './electricalCalculations';

/**
 * Cached utility for preparing nodes with HT voltage calculations
 * Reduces redundant calculations across multiple store operations
 */
class NodeUtilities {
  private cache = new Map<string, Node[]>();
  private lastProjectHash: string | null = null;

  /**
   * Prepare nodes with realistic HT-based voltage calculations (cached)
   */
  prepareNodesWithHT(project: Project, calculator: ElectricalCalculator): Node[] {
    const projectHash = this.generateProjectHash(project);
    
    if (this.lastProjectHash === projectHash && this.cache.has(projectHash)) {
      return this.cache.get(projectHash)!;
    }

    const modifiedNodes = project.nodes.map(node => {
      if (node.isSource && (node as any).tensionHT) {
        // Simply use the HT voltage as target voltage for now
        const tensionBTRealiste = (node as any).tensionHT;
        
        return {
          ...node,
          tensionCible: tensionBTRealiste,
          tensionBTRealiste
        };
      }
      return { ...node };
    });

    // Cache the result
    this.cache.set(projectHash, modifiedNodes);
    this.lastProjectHash = projectHash;
    
    return modifiedNodes;
  }

  /**
   * Clear cache when project changes significantly
   */
  clearCache(): void {
    this.cache.clear();
    this.lastProjectHash = null;
  }

  private generateProjectHash(project: Project): string {
    // Simple hash based on key project properties
    const hashData = {
      nodeCount: project.nodes.length,
      cableCount: project.cables.length,
      voltageSystem: project.voltageSystem,
      transformerConfig: project.transformerConfig,
      htVoltages: project.nodes
        .filter(n => n.isSource && (n as any).tensionHT)
        .map(n => (n as any).tensionHT)
        .join(',')
    };
    
    return JSON.stringify(hashData);
  }

  private createDefaultTransformerConfig(voltageSystem: string): TransformerConfig {
    return {
      rating: '400kVA' as TransformerRating,
      nominalPower_kVA: 400,
      nominalVoltage_V: voltageSystem === 'TRIPHASÉ_230V' ? 230 : 400,
      shortCircuitVoltage_percent: 4,
      cosPhi: 0.95
    };
  }
}

export const nodeUtilities = new NodeUtilities();