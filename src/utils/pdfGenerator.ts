import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { generateCableDetailsTable } from './tableGenerator';
import { Project, CalculationResult, CalculationScenario } from '@/types/network';
import { getConnectedNodes, getConnectedCables } from '@/utils/networkConnectivity';

export interface PDFData {
  project: Project;
  results: Record<CalculationScenario, CalculationResult | null>;
  selectedScenario: CalculationScenario;
}

export class PDFGenerator {
  private pdf: jsPDF;
  private pageHeight = 297; // A4 height in mm
  private margin = 20;
  private currentY = 20;

  constructor() {
    this.pdf = new jsPDF('p', 'mm', 'a4');
  }

  private addTitle(text: string, fontSize = 16) {
    this.pdf.setFontSize(fontSize);
    this.pdf.setFont('helvetica', 'bold');
    this.pdf.text(text, this.margin, this.currentY);
    this.currentY += 10;
  }

  private addSubtitle(text: string, fontSize = 12) {
    this.pdf.setFontSize(fontSize);
    this.pdf.setFont('helvetica', 'bold');
    this.pdf.text(text, this.margin, this.currentY);
    this.currentY += 8;
  }

  private addText(text: string, fontSize = 10, x = this.margin) {
    this.pdf.setFontSize(fontSize);
    this.pdf.setFont('helvetica', 'normal');
    this.pdf.text(text, x, this.currentY);
    this.currentY += 6;
  }

  private addBoldText(text: string, fontSize = 10, x = this.margin) {
    this.pdf.setFontSize(fontSize);
    this.pdf.setFont('helvetica', 'bold');
    this.pdf.text(text, x, this.currentY);
    this.currentY += 6;
  }

  private addLine() {
    this.pdf.line(this.margin, this.currentY, 200 - this.margin, this.currentY);
    this.currentY += 5;
  }

  private checkPageBreak(additionalHeight = 20) {
    if (this.currentY + additionalHeight > this.pageHeight - this.margin) {
      this.pdf.addPage();
      this.currentY = this.margin;
    }
  }

  private formatScenarioName(scenario: CalculationScenario): string {
    switch (scenario) {
      case 'PRÉLÈVEMENT': return 'Prélèvement seul';
      case 'MIXTE': return 'Mixte (Prélèvement + Production)';
      case 'PRODUCTION': return 'Production seule';
    }
  }

  private getComplianceText(compliance: 'normal' | 'warning' | 'critical'): string {
    switch (compliance) {
      case 'normal': return 'Conforme EN 50160';
      case 'warning': return 'Attention ±8-10%';
      case 'critical': return 'Non conforme >±10%';
    }
  }

  // Fonction pour obtenir la numérotation séquentielle des circuits
  private getCircuitNumber(circuitId: string, project: Project, result: CalculationResult): number {
    if (!result?.virtualBusbar?.circuits) return 0;
    
    const sourceNode = project.nodes.find(n => n.isSource);
    if (!sourceNode) return 0;
    
    const mainCircuitCables = project.cables
      .filter(cable => cable.nodeAId === sourceNode.id || cable.nodeBId === sourceNode.id)
      .sort((a, b) => a.id.localeCompare(b.id));
    
    const circuitIndex = mainCircuitCables.findIndex(cable => cable.id === circuitId);
    return circuitIndex >= 0 ? circuitIndex + 1 : 0;
  }

  // Calculer les statistiques par circuit (similaire à ResultsPanel)
  private getCircuitStatistics(project: Project, result: CalculationResult) {
    if (!project?.cables || !project?.nodes || !result?.virtualBusbar?.circuits) {
      return { totalLength: 0, circuitStats: [], connectedCableCount: 0 };
    }
    
    const connectedNodes = getConnectedNodes(project.nodes, project.cables);
    const connectedCables = getConnectedCables(project.cables, connectedNodes);
    
    const getAllCablesInSubtree = (startNodeId: string, sourceNodeId: string): string[] => {
      const cableIds = new Set<string>();
      const visited = new Set<string>();
      const stack = [startNodeId];
      
      while (stack.length > 0) {
        const currentNodeId = stack.pop()!;
        if (visited.has(currentNodeId)) continue;
        visited.add(currentNodeId);
        
        const connectedCablesFromNode = project.cables.filter(cable => {
          const isConnected = cable.nodeAId === currentNodeId || cable.nodeBId === currentNodeId;
          const otherNodeId = cable.nodeAId === currentNodeId ? cable.nodeBId : cable.nodeAId;
          return isConnected && (otherNodeId !== sourceNodeId || cableIds.size === 0);
        });
        
        connectedCablesFromNode.forEach(cable => {
          if (!cableIds.has(cable.id)) {
            cableIds.add(cable.id);
            const otherNodeId = cable.nodeAId === currentNodeId ? cable.nodeBId : cable.nodeAId;
            if (!visited.has(otherNodeId) && otherNodeId !== sourceNodeId) {
              stack.push(otherNodeId);
            }
          }
        });
      }
      
      return Array.from(cableIds);
    };
    
    let totalLength = 0;
    const circuitStats: Array<{
      circuitId: string;
      circuitName: string;
      circuitNumber: number;
      length: number;
      cableCount: number;
      subtreeSkVA: number;
      direction: string;
      cables: any[];
      compliance: 'normal' | 'warning' | 'critical';
      minVoltage: number;
      maxVoltage: number;
    }> = [];
    
    const sourceNode = project.nodes.find(n => n.isSource);
    if (!sourceNode) {
      return { totalLength: 0, circuitStats: [], connectedCableCount: connectedCables.length };
    }
    
    const sortedCircuits = result.virtualBusbar.circuits
      .map(circuit => ({ ...circuit, circuitNumber: this.getCircuitNumber(circuit.circuitId, project, result) }))
      .sort((a, b) => a.circuitNumber - b.circuitNumber);
    
    const allAssignedCableIds = new Set<string>();
    
    sortedCircuits.forEach(circuit => {
      const mainCable = project.cables.find(c => c.id === circuit.circuitId);
      if (!mainCable) return;
      
      const downstreamNodeId = mainCable.nodeAId === sourceNode.id ? mainCable.nodeBId : mainCable.nodeAId;
      const subtreeCableIds = getAllCablesInSubtree(downstreamNodeId, sourceNode.id);
      
      if (!subtreeCableIds.includes(circuit.circuitId)) {
        subtreeCableIds.unshift(circuit.circuitId);
      }
      
      const circuitCables = connectedCables.filter(cable => {
        const isInSubtree = subtreeCableIds.includes(cable.id);
        const notAlreadyAssigned = !allAssignedCableIds.has(cable.id);
        
        if (isInSubtree && notAlreadyAssigned) {
          allAssignedCableIds.add(cable.id);
          return true;
        }
        return false;
      });
      
      const circuitLength = circuitCables.reduce((sum, cable) => sum + (cable.length_m || 0), 0);
      totalLength += circuitLength;
      
      const circuitNumber = this.getCircuitNumber(circuit.circuitId, project, result);
      
      // Déterminer la conformité du circuit
      let circuitCompliance: 'normal' | 'warning' | 'critical' = 'normal';
      const nominalVoltage = project.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230;
      const minDropPercent = Math.abs((nominalVoltage - circuit.minNodeVoltage_V) / nominalVoltage * 100);
      const maxDropPercent = Math.abs((nominalVoltage - circuit.maxNodeVoltage_V) / nominalVoltage * 100);
      const worstDrop = Math.max(minDropPercent, maxDropPercent);
      
      if (worstDrop > 10) circuitCompliance = 'critical';
      else if (worstDrop > 8) circuitCompliance = 'warning';
      
      circuitStats.push({
        circuitId: circuit.circuitId,
        circuitName: `Circuit ${circuitNumber}`,
        circuitNumber,
        length: circuitLength,
        cableCount: circuitCables.length,
        subtreeSkVA: circuit.subtreeSkVA,
        direction: circuit.direction,
        cables: circuitCables,
        compliance: circuitCompliance,
        minVoltage: circuit.minNodeVoltage_V,
        maxVoltage: circuit.maxNodeVoltage_V
      });
    });
    
    return { totalLength, circuitStats, connectedCableCount: connectedCables.length };
  }

  // Section 1: Détail général de la source
  private addSourceDetails(data: PDFData) {
    this.addSubtitle('Détail Général de la Source');
    
    const currentResult = data.results[data.selectedScenario];
    if (!currentResult) {
      this.addText('Aucun calcul disponible');
      return;
    }

    // Informations générales du projet
    this.addBoldText('Informations du projet :', 10);
    this.addText(`Projet: ${data.project.name}`);
    this.addText(`Système de tension: ${data.project.voltageSystem === 'TÉTRAPHASÉ_400V' ? '400V Tétraphasé' : '230V Triphasé'}`);
    this.addText(`cos φ = ${data.project.cosPhi}`);
    this.addText(`Scénario: ${this.formatScenarioName(data.selectedScenario)}`);
    this.addText(`Conformité: ${this.getComplianceText(currentResult.compliance)}`);
    this.currentY += 5;

    // Calcul charge contractuelle
    const connectedNodes = getConnectedNodes(data.project.nodes, data.project.cables);
    const connectedNodesData = data.project.nodes.filter(node => connectedNodes.has(node.id));
    const chargeContractuelle = connectedNodesData.reduce((sum, node) => 
      sum + node.clients.reduce((clientSum, client) => clientSum + client.S_kVA, 0), 0);

    // Charges, productions et pertes
    this.addBoldText('Bilan énergétique :', 10);
    this.addText(`Charge contractuelle: ${chargeContractuelle.toFixed(1)} kVA`);
    this.addText(`Foisonnement charges: ${data.project.foisonnementCharges}%`);
    this.addText(`Charge foisonnée: ${currentResult.totalLoads_kVA.toFixed(1)} kVA`);
    this.addText(`Productions totales: ${currentResult.totalProductions_kVA.toFixed(1)} kVA`);
    this.addText(`Pertes globales: ${currentResult.globalLosses_kW.toFixed(3)} kW`);
    this.addText(`Chute de tension max: ${currentResult.maxVoltageDropPercent.toFixed(2)}%${currentResult.maxVoltageDropCircuitNumber ? ` (Circuit ${currentResult.maxVoltageDropCircuitNumber})` : ''}`);
    this.currentY += 5;

    // Informations transformateur et jeu de barres
    if (currentResult.virtualBusbar) {
      this.addBoldText('Transformateur :', 10);
      this.addText(`Puissance: ${data.project.transformerConfig.rating}`);
      this.addText(`Tension de court-circuit: ${data.project.transformerConfig.shortCircuitVoltage_percent}% Ucc`);
      this.addText(`Pertes transformateur: ${currentResult.virtualBusbar.losses_kW?.toFixed(3) || 0} kW`);
      this.currentY += 3;

      this.addBoldText('Jeu de barres :', 10);
      this.addText(`Tension: ${currentResult.virtualBusbar.voltage_V.toFixed(1)} V`);
      this.addText(`Courant total: ${currentResult.virtualBusbar.current_A.toFixed(1)} A`);
      this.addText(`Puissance nette: ${currentResult.virtualBusbar.netSkVA.toFixed(1)} kVA`);
      this.addText(`Chute de tension: ${currentResult.virtualBusbar.deltaU_percent?.toFixed(2) || 0}%`);
      this.currentY += 5;
    }

    // Statistiques câbles globales
    const cableStats = this.getCircuitStatistics(data.project, currentResult);
    this.addBoldText('Statistiques des câbles :', 10);
    this.addText(`Longueur totale: ${cableStats.totalLength.toFixed(0)} m`);
    this.addText(`Nombre de tronçons: ${cableStats.connectedCableCount}`);
    
    this.currentY += 10;
  }

  // Section 2: Détail par circuits avec conformité
  private addCircuitDetails(data: PDFData) {
    this.checkPageBreak(80);
    this.addSubtitle('Détail par Circuits');
    
    const currentResult = data.results[data.selectedScenario];
    if (!currentResult) {
      this.addText('Aucun calcul disponible');
      return;
    }

    const cableStats = this.getCircuitStatistics(data.project, currentResult);
    
    if (cableStats.circuitStats.length === 0) {
      this.addText('Aucun circuit détecté');
      return;
    }

    cableStats.circuitStats.forEach(circuit => {
      this.checkPageBreak(40);
      
      // Nom du circuit avec indicateur de conformité
      const complianceText = this.getComplianceText(circuit.compliance);
      this.addBoldText(`${circuit.circuitName} - ${complianceText}`, 11);
      
      // Informations générales du circuit
      this.addText(`Direction: ${circuit.direction}`);
      this.addText(`Puissance: ${Math.abs(circuit.subtreeSkVA).toFixed(1)} kVA`);
      this.addText(`Longueur: ${circuit.length.toFixed(0)} m`);
      this.addText(`Nombre de tronçons: ${circuit.cableCount}`);
      this.addText(`Tension min: ${circuit.minVoltage.toFixed(1)} V`);
      this.addText(`Tension max: ${circuit.maxVoltage.toFixed(1)} V`);
      
      const nominalVoltage = data.project.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230;
      const minDropPercent = Math.abs((nominalVoltage - circuit.minVoltage) / nominalVoltage * 100);
      const maxDropPercent = Math.abs((nominalVoltage - circuit.maxVoltage) / nominalVoltage * 100);
      const worstDrop = Math.max(minDropPercent, maxDropPercent);
      this.addText(`Chute de tension max: ${worstDrop.toFixed(2)}%`);
      
      this.currentY += 5;
      
      // Scénarios pour ce circuit (si plusieurs scénarios calculés)
      this.addText(`Scénario actuel: ${this.formatScenarioName(data.selectedScenario)}`, 9);
      
      // Aperçu des tronçons principaux de ce circuit
      if (circuit.cables.length > 0) {
        this.addText('Principaux tronçons:', 9);
        circuit.cables.slice(0, 3).forEach(cable => {
          const cableResult = currentResult.cables.find(c => c.id === cable.id);
          const cableType = data.project.cableTypes.find(ct => ct.id === cable.typeId);
          this.addText(`  • ${cable.name}: ${cableType?.label || 'N/A'}, ${cable.length_m?.toFixed(0) || 0}m, ${cableResult?.current_A?.toFixed(1) || 0}A`, 8);
        });
        if (circuit.cables.length > 3) {
          this.addText(`  ... et ${circuit.cables.length - 3} autres tronçons`, 8);
        }
      }
      
      this.currentY += 8;
    });
  }

  // Section 3: Détail des tronçons
  private addCableDetails(data: PDFData) {
    this.checkPageBreak(120);
    this.addSubtitle('Détail des Tronçons');

    const currentResult = data.results[data.selectedScenario];
    if (!currentResult) {
      this.addText('Aucun calcul disponible');
      return;
    }

    // Trier les câbles par nom/numéro
    const sortedCables = [...currentResult.cables].sort((a, b) => {
      const numA = parseInt(a.name.match(/\d+/)?.[0] || '999');
      const numB = parseInt(b.name.match(/\d+/)?.[0] || '999');
      return numA - numB;
    });

    // En-têtes du tableau
    const headers = ['Câble', 'Type', 'L(m)', 'I(A)', 'ΔU(%)', 'Pertes(kW)', 'U dép.(V)', 'U arr.(V)'];
    const colWidths = [20, 25, 15, 15, 15, 18, 18, 18];
    let x = this.margin;

    this.pdf.setFont('helvetica', 'bold');
    this.pdf.setFontSize(9);
    headers.forEach((header, i) => {
      this.pdf.text(header, x, this.currentY);
      x += colWidths[i];
    });
    this.currentY += 6;
    this.addLine();

    // Données des câbles
    this.pdf.setFont('helvetica', 'normal');
    this.pdf.setFontSize(8);
    
    sortedCables.forEach(cable => {
      this.checkPageBreak(8);
      
      const projectCable = data.project.cables.find(c => c.id === cable.id);
      const cableType = data.project.cableTypes.find(ct => ct.id === projectCable?.typeId);
      
      // Tensions de départ et d'arrivée
      const baseVoltage = data.project.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230;
      const nodeVoltageDropResult = currentResult.nodeVoltageDrops?.find(nvd => 
        nvd.nodeId === projectCable?.nodeBId || nvd.nodeId === projectCable?.nodeAId
      );
      const arrivalVoltage = baseVoltage - (nodeVoltageDropResult?.deltaU_cum_V || 0);
      
      x = this.margin;
      const values = [
        cable.name,
        cableType?.label || '-',
        cable.length_m?.toFixed(0) || '0',
        cable.current_A?.toFixed(1) || '0.0',
        cable.voltageDropPercent?.toFixed(2) || '0.00',
        cable.losses_kW?.toFixed(3) || '0.000',
        baseVoltage.toFixed(0),
        arrivalVoltage.toFixed(0)
      ];
      
      values.forEach((value, i) => {
        this.pdf.text(value, x, this.currentY);
        x += colWidths[i];
      });
      this.currentY += 5;
    });

    this.currentY += 10;
  }

  public async generateReport(data: PDFData): Promise<void> {
    // Page de titre
    this.addTitle('Rapport de Calcul de Réseau Électrique', 18);
    this.addText(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`);
    this.currentY += 15;

    // Section 1: Détail général de la source
    this.addSourceDetails(data);

    // Section 2: Détail par circuits
    this.addCircuitDetails(data);

    // Section 3: Détail des tronçons
    this.addCableDetails(data);

    // Télécharger le PDF
    const fileName = `Rapport_${data.project.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
    this.pdf.save(fileName);
  }
}