import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { generateCableDetailsTable } from './tableGenerator';
import { Project, CalculationResult, CalculationScenario, SimulationResult } from '@/types/network';
import { SRG2SimulationResult } from '@/types/srg2';
import { getConnectedNodes, getConnectedCables } from '@/utils/networkConnectivity';

export interface PDFData {
  project: Project;
  results: Record<CalculationScenario, CalculationResult | null>;
  selectedScenario: CalculationScenario;
  simulationResults?: SimulationResult;
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

  private addHighlightedBoldText(text: string, fontSize = 10, x = this.margin) {
    this.pdf.setFontSize(fontSize);
    this.pdf.setFont('helvetica', 'bold');
    
    // Calculer la largeur du texte pour le rectangle de surlignage
    const textWidth = this.pdf.getTextWidth(text);
    
    // Ajouter un rectangle de surlignage jaune
    this.pdf.setFillColor(255, 255, 0); // Jaune
    this.pdf.rect(x - 1, this.currentY - 4, textWidth + 2, 6, 'F');
    
    // Ajouter le texte en gras
    this.pdf.setTextColor(0, 0, 0); // Noir
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

    // Calcul charge et production contractuelles
    const connectedNodes = getConnectedNodes(data.project.nodes, data.project.cables);
    const connectedNodesData = data.project.nodes.filter(node => connectedNodes.has(node.id));
    const chargeContractuelle = connectedNodesData.reduce((sum, node) => 
      sum + node.clients.reduce((clientSum, client) => clientSum + client.S_kVA, 0), 0);
    const productionContractuelle = connectedNodesData.reduce((sum, node) => 
      sum + node.productions.reduce((prodSum, prod) => prodSum + prod.S_kVA, 0), 0);
    const productionFoisonnee = productionContractuelle * (data.project.foisonnementProductions / 100);

    // Charges, productions et pertes
    this.addBoldText('Bilan énergétique :', 10);
    this.addText(`Charge contractuelle: ${chargeContractuelle.toFixed(1)} kVA`);
    this.addHighlightedBoldText(`Foisonnement charges: ${data.project.foisonnementCharges}%`);
    this.addHighlightedBoldText(`Charge foisonnée: ${currentResult.totalLoads_kVA.toFixed(1)} kVA`);
    this.addText(`Production contractuelle: ${productionContractuelle.toFixed(1)} kVA`);
    this.addHighlightedBoldText(`Foisonnement productions: ${data.project.foisonnementProductions}%`);
    this.addHighlightedBoldText(`Production foisonnée: ${productionFoisonnee.toFixed(1)} kVA`);
    this.addText(`Pertes globales: ${currentResult.globalLosses_kW.toFixed(3)} kW`);
    this.addText(`Chute de tension max: ${currentResult.maxVoltageDropPercent.toFixed(2)}%${currentResult.maxVoltageDropCircuitNumber ? ` (Circuit ${currentResult.maxVoltageDropCircuitNumber})` : ''}`);
    this.currentY += 5;

    // Modèle de calcul
    this.addBoldText('Modèle de calcul :', 10);
    const loadModelText = data.project.loadModel === 'monophase_reparti' 
      ? 'Monophasé réparti' 
      : 'Polyphasé équilibré';
    this.addText(`Modèle de charge: ${loadModelText}`);
    this.currentY += 3;

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
      this.currentY += 3;
      
      // Données du neutre (mode monophasé uniquement)
      if (data.project.loadModel === 'monophase_reparti' && currentResult.virtualBusbar.current_N !== undefined) {
        this.addBoldText('Données du neutre :', 10);
        this.addText(`Courant neutre (I_N): ${currentResult.virtualBusbar.current_N.toFixed(1)} A`);
        this.addText(`Chute de tension neutre (ΔU_N): ${currentResult.virtualBusbar.deltaU_V >= 0 ? '+' : ''}${currentResult.virtualBusbar.deltaU_V.toFixed(2)} V`);
        this.currentY += 3;
      }
      
      this.currentY += 2;
    }

    // Répartition par phase (mode monophasé)
    if (data.project.loadModel === 'monophase_reparti') {
      this.checkPageBreak(50);
      this.addBoldText('Répartition par phase :', 10);
      
      // Calculer les totaux par phase
      let chargePhaseA = 0, chargePhaseB = 0, chargePhaseC = 0;
      let prodPhaseA = 0, prodPhaseB = 0, prodPhaseC = 0;
      
      connectedNodesData.forEach(node => {
        // Distribution des charges selon les pourcentages
        const pA = node.phaseDistribution?.charges?.A ?? 0.333;
        const pB = node.phaseDistribution?.charges?.B ?? 0.333;
        const pC = node.phaseDistribution?.charges?.C ?? 0.333;
        
        const totalCharges = node.clients.reduce((sum, c) => sum + c.S_kVA, 0);
        chargePhaseA += totalCharges * pA;
        chargePhaseB += totalCharges * pB;
        chargePhaseC += totalCharges * pC;
        
        // Distribution des productions
        const pA_prod = node.phaseDistribution?.productions?.A ?? 0.333;
        const pB_prod = node.phaseDistribution?.productions?.B ?? 0.333;
        const pC_prod = node.phaseDistribution?.productions?.C ?? 0.333;
        
        const totalProds = node.productions.reduce((sum, p) => sum + p.S_kVA, 0);
        prodPhaseA += totalProds * pA_prod;
        prodPhaseB += totalProds * pB_prod;
        prodPhaseC += totalProds * pC_prod;
      });
      
      // Appliquer le foisonnement
      const foison_charges = data.project.foisonnementCharges / 100;
      const foison_prods = data.project.foisonnementProductions / 100;
      
      this.addText(`Charges contractuelles par phase :`);
      this.addText(`  Phase A: ${chargePhaseA.toFixed(1)} kVA (foisonné: ${(chargePhaseA * foison_charges).toFixed(1)} kVA)`);
      this.addText(`  Phase B: ${chargePhaseB.toFixed(1)} kVA (foisonné: ${(chargePhaseB * foison_charges).toFixed(1)} kVA)`);
      this.addText(`  Phase C: ${chargePhaseC.toFixed(1)} kVA (foisonné: ${(chargePhaseC * foison_charges).toFixed(1)} kVA)`);
      this.currentY += 3;
      
      this.addText(`Productions contractuelles par phase :`);
      this.addText(`  Phase A: ${prodPhaseA.toFixed(1)} kVA (foisonné: ${(prodPhaseA * foison_prods).toFixed(1)} kVA)`);
      this.addText(`  Phase B: ${prodPhaseB.toFixed(1)} kVA (foisonné: ${(prodPhaseB * foison_prods).toFixed(1)} kVA)`);
      this.addText(`  Phase C: ${prodPhaseC.toFixed(1)} kVA (foisonné: ${(prodPhaseC * foison_prods).toFixed(1)} kVA)`);
      this.currentY += 5;
    }

    // Compensateurs de neutre
    if (data.simulationResults?.equipment?.neutralCompensators && 
        data.simulationResults.equipment.neutralCompensators.length > 0) {
      this.checkPageBreak(60);
      this.addBoldText('Compensateurs de neutre :', 11);
      this.currentY += 2;
      
      data.simulationResults.equipment.neutralCompensators.forEach(comp => {
        const node = data.project.nodes.find(n => n.id === comp.nodeId);
        const nodeName = node?.name || comp.nodeId;
        const statusText = comp.isLimited ? 'Saturé' : (comp.enabled ? 'Actif' : 'Inactif');
        
        this.addBoldText(`• ${nodeName}`, 10);
        this.addText(`  Puissance: ${comp.maxPower_kVA.toFixed(1)} kVAr (Tolérance: ${comp.tolerance_A.toFixed(0)}A)`, 9);
        this.addText(`  État: ${statusText}`, 9);
        
        if (comp.iN_initial_A !== undefined && comp.currentIN_A !== undefined) {
          this.addText(`  I_N avant: ${comp.iN_initial_A.toFixed(1)} A → après: ${comp.currentIN_A.toFixed(1)} A`, 9);
          if (comp.reductionPercent !== undefined) {
            this.addText(`  Réduction: ${comp.reductionPercent.toFixed(1)}%`, 9);
          }
        }
        
        if (comp.u1p_V !== undefined && comp.u2p_V !== undefined && comp.u3p_V !== undefined) {
          this.addText(`  Tensions après compensation:`, 9);
          this.addText(`    Phase A: ${comp.u1p_V.toFixed(1)} V, Phase B: ${comp.u2p_V.toFixed(1)} V, Phase C: ${comp.u3p_V.toFixed(1)} V`, 8);
        }
        
        this.currentY += 4;
      });
      
      this.currentY += 2;
    }

    // Régulateurs SRG2
    if (data.simulationResults?.equipment?.srg2Devices && 
        data.simulationResults.equipment.srg2Devices.length > 0) {
      this.checkPageBreak(80);
      this.addBoldText('Régulateurs SRG2 :', 11);
      this.currentY += 2;
      
      data.simulationResults.equipment.srg2Devices.forEach(srg2 => {
        const node = data.project.nodes.find(n => n.id === srg2.nodeId);
        const nodeName = node?.name || srg2.nodeId;
        const typeText = srg2.type || 'SRG2';
        const modeText = srg2.mode || 'AUTO';
        const statusText = srg2.status || 'ACTIF';
        
        this.addBoldText(`• ${srg2.name || nodeName} - Type: ${typeText}`, 10);
        this.addText(`  Mode: ${modeText} - État: ${statusText}`, 9);
        
        // Récupérer les résultats de simulation depuis simulationResults
        const srg2Result = data.simulationResults?.nodeMetricsPerPhase?.find(m => m.nodeId === srg2.nodeId);
        
        if (srg2Result) {
          const result: any = {
            phaseResults: {
              A: { inputVoltage_V: srg2Result.voltagesPerPhase.A, outputVoltage_V: srg2Result.voltagesPerPhase.A, switchState: 'BYP', appliedCoefficient: 100 },
              B: { inputVoltage_V: srg2Result.voltagesPerPhase.B, outputVoltage_V: srg2Result.voltagesPerPhase.B, switchState: 'BYP', appliedCoefficient: 100 },
              C: { inputVoltage_V: srg2Result.voltagesPerPhase.C, outputVoltage_V: srg2Result.voltagesPerPhase.C, switchState: 'BYP', appliedCoefficient: 100 }
            },
            hasConstraints: false,
            isPowerLimitReached: false
          };
          
          // Résultats par phase
          if (result.phaseResults) {
            this.addText(`  Résultats par phase:`, 9);
            
            ['A', 'B', 'C'].forEach(phase => {
              const phaseKey = phase as 'A' | 'B' | 'C';
              const phaseResult = result.phaseResults![phaseKey];
              
              if (phaseResult) {
                const switchState = phaseResult.switchState || 'BYP';
                const coeff = phaseResult.appliedCoefficient || 100;
                const sign = coeff >= 100 ? '+' : '';
                const coeffPercent = coeff - 100;
                
                this.addText(`    Phase ${phase}: Entrée ${phaseResult.inputVoltage_V.toFixed(1)}V → Sortie ${phaseResult.outputVoltage_V.toFixed(1)}V (${switchState} ${sign}${coeffPercent.toFixed(1)}%)`, 8);
              }
            });
          }
          
          // Contraintes et limites
          const constraintText = result.hasConstraints ? 'Oui' : 'Non';
          const powerLimitText = result.isPowerLimitReached ? 'Oui' : 'Non';
          this.addText(`  Contraintes actives: ${constraintText} - Limite puissance: ${powerLimitText}`, 9);
        }
        
        this.currentY += 4;
      });
      
      this.currentY += 2;
    }

    // Upgrades de câbles proposés
    if (data.simulationResults?.equipment?.cableUpgrades && 
        data.simulationResults.equipment.cableUpgrades.length > 0) {
      this.checkPageBreak(60);
      this.addBoldText('Upgrades de câbles proposés :', 11);
      this.currentY += 2;
      
      data.simulationResults.equipment.cableUpgrades.forEach(upgrade => {
        const cable = data.project.cables.find(c => c.id === upgrade.originalCableId);
        const cableName = cable?.name || upgrade.originalCableId;
        const oldType = data.project.cableTypes.find(ct => ct.id === cable?.typeId);
        const newType = data.project.cableTypes.find(ct => ct.id === upgrade.newCableTypeId);
        
        let reasonText = 'Amélioration';
        if (upgrade.reason === 'voltage_drop') reasonText = 'Chute de tension excessive';
        else if (upgrade.reason === 'overload') reasonText = 'Surcharge';
        else if (upgrade.reason === 'both') reasonText = 'Surcharge et chute de tension';
        
        this.addBoldText(`• Câble ${cableName} - ${reasonText}`, 10);
        this.addText(`  Actuel: ${oldType?.label || 'N/A'}`, 9);
        this.addText(`  Proposé: ${newType?.label || 'N/A'}`, 9);
        this.addText(`  Amélioration ΔU: ${upgrade.improvement.voltageDropReduction.toFixed(2)}%`, 9);
        this.addText(`  Réduction pertes: ${upgrade.improvement.lossReduction_kW.toFixed(3)} kW (${upgrade.improvement.lossReductionPercent.toFixed(1)}%)`, 9);
        
        this.currentY += 4;
      });
      
      this.currentY += 2;
    }

    // Statistiques câbles globales
    const cableStats = this.getCircuitStatistics(data.project, currentResult);
    this.checkPageBreak(20);
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