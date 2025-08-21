import jsPDF from 'jspdf';
import domtoimage from 'dom-to-image';
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

  private async waitForMapReady(): Promise<void> {
    return new Promise((resolve) => {
      // Attendre que tous les éléments de la carte soient chargés
      const checkReady = () => {
        const svgElements = document.querySelectorAll('#map-container svg');
        const pathElements = document.querySelectorAll('#map-container path');
        const tileImages = document.querySelectorAll('#map-container .leaflet-tile');
        
        // Vérifier si les tuiles sont chargées
        const tilesLoaded = Array.from(tileImages).every(img => 
          (img as HTMLImageElement).complete
        );
        
        // Vérifier si il y a des câbles (éléments SVG/path)
        const cablesPresent = svgElements.length > 0 || pathElements.length > 0;
        
        if (tilesLoaded && cablesPresent) {
          resolve();
        } else {
          setTimeout(checkReady, 500);
        }
      };
      
      checkReady();
      
      // Timeout de sécurité après 10 secondes
      setTimeout(resolve, 10000);
    });
  }

  private async addNetworkScreenshot() {
    this.checkPageBreak(120);
    this.addSubtitle('Plan du Réseau');

    try {
      const mapContainer = document.querySelector('#map-container') as HTMLElement;
      if (!mapContainer) {
        this.addText('Impossible de capturer la carte');
        return;
      }

      // Attendre intelligemment que la carte soit prête
      await this.waitForMapReady();

      // Utiliser dom-to-image pour une capture plus moderne et précise
      const imgData = await domtoimage.toPng(mapContainer, {
        quality: 1.0,
        bgcolor: '#f0f0f0',
        width: mapContainer.clientWidth * 2, // Haute résolution
        height: mapContainer.clientHeight * 2,
        style: {
          transform: 'scale(2)',
          transformOrigin: 'top left',
          width: mapContainer.clientWidth + 'px',
          height: mapContainer.clientHeight + 'px'
        },
        filter: (node) => {
          // Exclure les contrôles UI
          if (node instanceof HTMLElement) {
            return !node.classList.contains('leaflet-control-container') &&
                   !node.classList.contains('leaflet-control') &&
                   !node.classList.contains('absolute') &&
                   node.tagName !== 'BUTTON';
          }
          return true;
        }
      });
      
      // Calculer les dimensions pour s'adapter à la page
      const pageWidth = 200 - (2 * this.margin);
      const imgWidth = pageWidth;
      
      // Créer une image temporaire pour obtenir les dimensions
      const tempImg = new Image();
      await new Promise((resolve, reject) => {
        tempImg.onload = resolve;
        tempImg.onerror = reject;
        tempImg.src = imgData;
      });
      
      const imgHeight = (tempImg.height * imgWidth) / tempImg.width;
      
      // Vérifier si l'image tient sur la page
      if (imgHeight > 150) {
        const adjustedHeight = 150;
        const adjustedWidth = (tempImg.width * adjustedHeight) / tempImg.height;
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
      
      // Fallback avec délai fixe si la détection intelligente échoue
      try {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const mapContainer = document.querySelector('#map-container') as HTMLElement;
        if (mapContainer) {
          const imgData = await domtoimage.toPng(mapContainer, {
            quality: 0.95,
            bgcolor: '#f0f0f0'
          });
          
          const pageWidth = 200 - (2 * this.margin);
          this.pdf.addImage(imgData, 'PNG', this.margin, this.currentY, pageWidth, 120);
          this.currentY += 130;
        }
      } catch (fallbackError) {
        console.error('Erreur fallback:', fallbackError);
        this.addText('Capture impossible - carte non disponible');
      }
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