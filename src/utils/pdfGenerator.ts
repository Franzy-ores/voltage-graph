import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Project, CalculationResult, CalculationScenario } from '@/types/network';

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

  private addText(text: string, fontSize = 10) {
    this.pdf.setFontSize(fontSize);
    this.pdf.setFont('helvetica', 'normal');
    this.pdf.text(text, this.margin, this.currentY);
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
      case 'PRÉLÈVEMENT': return 'Prélèvement';
      case 'MIXTE': return 'Mixte';
      case 'PRODUCTION': return 'Production';
    }
  }

  private getCableStatistics(project: Project) {
    const totalLength = project.cables.reduce((sum, cable) => sum + (cable.length_m || 0), 0);
    const cableCount = project.cables.length;
    
    const lengthByType = project.cables.reduce((acc, cable) => {
      const cableType = project.cableTypes.find(type => type.id === cable.typeId);
      const typeName = cableType ? cableType.label : 'Inconnu';
      acc[typeName] = (acc[typeName] || 0) + (cable.length_m || 0);
      return acc;
    }, {} as Record<string, number>);

    return { totalLength, cableCount, lengthByType };
  }

  private addGlobalSummary(data: PDFData) {
    this.addSubtitle('Résumé Global');
    
    const currentResult = data.results[data.selectedScenario];
    if (!currentResult) {
      this.addText('Aucun calcul disponible');
      return;
    }

    // Informations du projet
    this.addText(`Projet: ${data.project.name}`);
    this.addText(`Système de tension: ${data.project.voltageSystem === 'TÉTRAPHASÉ_400V' ? '400V' : '230V'}`);
    this.addText(`cos φ = ${data.project.cosPhi}`);
    this.addText(`Scénario sélectionné: ${this.formatScenarioName(data.selectedScenario)}`);
    this.currentY += 5;

    // Charges et productions totales
    this.addText(`Charges totales: ${currentResult.totalLoads_kVA.toFixed(2)} kVA`);
    this.addText(`Productions totales: ${currentResult.totalProductions_kVA.toFixed(2)} kVA`);
    this.addText(`Pertes totales: ${currentResult.globalLosses_kW.toFixed(2)} kW`);
    this.addText(`Chute de tension max: ${currentResult.maxVoltageDropPercent.toFixed(2)} %`);
    this.currentY += 5;

    // Statistiques des câbles
    const cableStats = this.getCableStatistics(data.project);
    this.addText(`Longueur totale des câbles: ${cableStats.totalLength.toFixed(0)} m`);
    this.addText(`Nombre de tronçons: ${cableStats.cableCount}`);
    
    this.currentY += 3;
    this.addText('Répartition par type de câble:');
    Object.entries(cableStats.lengthByType).forEach(([type, length]) => {
      this.addText(`  • ${type}: ${length.toFixed(0)} m`, 9);
    });

    this.currentY += 10;
  }

  private addScenarioComparison(data: PDFData) {
    this.checkPageBreak(60);
    this.addSubtitle('Comparaison des Scénarios');

    const scenarios: CalculationScenario[] = ['PRÉLÈVEMENT', 'MIXTE', 'PRODUCTION'];
    
    // Headers
    const headers = ['Scénario', 'Charges (kVA)', 'Productions (kVA)', 'Pertes (kW)', 'Chute max (%)'];
    const colWidths = [40, 30, 35, 25, 30];
    let x = this.margin;

    this.pdf.setFont('helvetica', 'bold');
    headers.forEach((header, i) => {
      this.pdf.text(header, x, this.currentY);
      x += colWidths[i];
    });
    this.currentY += 8;
    this.addLine();

    // Data rows
    this.pdf.setFont('helvetica', 'normal');
    scenarios.forEach(scenario => {
      const result = data.results[scenario];
      if (result) {
        x = this.margin;
        const values = [
          this.formatScenarioName(scenario),
          result.totalLoads_kVA.toFixed(1),
          result.totalProductions_kVA.toFixed(1),
          result.globalLosses_kW.toFixed(2),
          result.maxVoltageDropPercent.toFixed(2)
        ];
        
        values.forEach((value, i) => {
          this.pdf.text(value, x, this.currentY);
          x += colWidths[i];
        });
        this.currentY += 6;
      }
    });

    this.currentY += 10;
  }

  private addCableDetails(data: PDFData) {
    this.checkPageBreak(80);
    this.addSubtitle('Détail par Tronçon');

    const currentResult = data.results[data.selectedScenario];
    if (!currentResult) {
      this.addText('Aucun calcul disponible');
      return;
    }

    // Trier les câbles par numéro
    const sortedCables = [...data.project.cables].sort((a, b) => {
      const numA = parseInt(a.name.match(/\d+/)?.[0] || '999');
      const numB = parseInt(b.name.match(/\d+/)?.[0] || '999');
      return numA - numB;
    });

    // Headers
    const headers = ['Câble', 'Longueur (m)', 'Courant (A)', 'Chute (%)', 'Pertes (W)'];
    const colWidths = [30, 25, 25, 25, 25];
    let x = this.margin;

    this.pdf.setFont('helvetica', 'bold');
    headers.forEach((header, i) => {
      this.pdf.text(header, x, this.currentY);
      x += colWidths[i];
    });
    this.currentY += 8;
    this.addLine();

    // Data rows
    this.pdf.setFont('helvetica', 'normal');
    sortedCables.forEach(cable => {
      this.checkPageBreak(10);
      
      // Chercher les données calculées pour ce câble dans les résultats
      const calculatedCable = currentResult.cables.find(c => c.id === cable.id);
      if (calculatedCable) {
        x = this.margin;
        const values = [
          cable.name,
          cable.length_m?.toFixed(0) || '0',
          calculatedCable.current_A?.toFixed(1) || '0.0',
          calculatedCable.voltageDropPercent?.toFixed(2) || '0.00',
          ((calculatedCable.losses_kW || 0) * 1000).toFixed(0) // Convertir kW en W
        ];
        
        values.forEach((value, i) => {
          this.pdf.text(value, x, this.currentY);
          x += colWidths[i];
        });
        this.currentY += 6;
      }
    });

    this.currentY += 10;
  }

  private async addNetworkScreenshot() {
    this.checkPageBreak(120);
    this.addSubtitle('Plan du Réseau');

    try {
      // Chercher le conteneur de la carte
      const mapContainer = document.querySelector('#map-container');
      if (!mapContainer) {
        this.addText('Impossible de capturer la carte');
        return;
      }

      // Attendre un moment pour s'assurer que tous les éléments sont rendus
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Prendre une capture d'écran avec une meilleure qualité
      const canvas = await html2canvas(mapContainer as HTMLElement, {
        useCORS: true,
        allowTaint: true,
        scale: 2, // Augmenter la qualité
        width: mapContainer.clientWidth,
        height: mapContainer.clientHeight,
        backgroundColor: '#f0f0f0',
        logging: false,
        ignoreElements: (element) => {
          // Ignorer les contrôles de l'interface utilisateur
          return element.classList.contains('leaflet-control-container') ||
                 element.classList.contains('leaflet-control') ||
                 element.tagName === 'BUTTON' ||
                 element.classList.contains('absolute');
        }
      });

      // Convertir en image
      const imgData = canvas.toDataURL('image/png', 0.95);
      
      // Calculer les dimensions pour s'adapter à la page
      const pageWidth = 200 - (2 * this.margin);
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      // Vérifier si l'image tient sur la page
      if (imgHeight > 150) {
        // Si trop grande, ajuster la hauteur
        const adjustedHeight = 150;
        const adjustedWidth = (canvas.width * adjustedHeight) / canvas.height;
        this.pdf.addImage(imgData, 'PNG', this.margin, this.currentY, adjustedWidth, adjustedHeight);
        this.currentY += adjustedHeight + 10;
      } else {
        this.pdf.addImage(imgData, 'PNG', this.margin, this.currentY, imgWidth, imgHeight);
        this.currentY += imgHeight + 10;
      }

      this.addText('Légende: Les câbles sont représentés par des lignes colorées selon leur chute de tension');

    } catch (error) {
      console.error('Erreur lors de la capture d\'écran:', error);
      this.addText('Erreur lors de la capture de la carte');
    }
  }

  public async generateReport(data: PDFData): Promise<void> {
    // Page de titre
    this.addTitle('Rapport de Calcul de Chute de Tension', 20);
    this.addText(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`);
    this.currentY += 15;

    // Résumé global
    this.addGlobalSummary(data);

    // Comparaison des scénarios
    this.addScenarioComparison(data);

    // Détails par tronçon
    this.addCableDetails(data);

    // Capture d'écran du réseau
    await this.addNetworkScreenshot();

    // Télécharger le PDF
    const fileName = `Rapport_${data.project.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
    this.pdf.save(fileName);
  }
}