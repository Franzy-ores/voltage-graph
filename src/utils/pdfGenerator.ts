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

  private async waitForMapReady(): Promise<void> {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 20;
      
      const checkReady = () => {
        attempts++;
        
        const mapContainer = document.querySelector('#map-container');
        const leafletMap = document.querySelector('#map-container .leaflet-container');
        const overlayPane = document.querySelector('#map-container .leaflet-overlay-pane');
        
        // Vérifier spécifiquement les éléments SVG des câbles
        const svgElements = document.querySelectorAll('#map-container .leaflet-overlay-pane svg');
        const pathElements = document.querySelectorAll('#map-container .leaflet-overlay-pane path');
        
        // Vérifier que les tuiles sont chargées
        const tileImages = document.querySelectorAll('#map-container .leaflet-tile');
        const tilesLoaded = tileImages.length === 0 || Array.from(tileImages).every(img => 
          (img as HTMLImageElement).complete
        );
        
        // Vérifier que les éléments de base et les câbles sont présents
        const mapReady = mapContainer && leafletMap && overlayPane;
        const cablesReady = svgElements.length > 0 && pathElements.length > 0;
        
        console.log(`Attempt ${attempts}: Map ready: ${mapReady}, Cables ready: ${cablesReady}, Tiles loaded: ${tilesLoaded}`);
        console.log(`SVG elements: ${svgElements.length}, Path elements: ${pathElements.length}`);
        
        if (mapReady && tilesLoaded && cablesReady) {
          // Attendre encore 2 secondes pour que les SVG soient complètement rendus
          setTimeout(resolve, 2000);
        } else if (attempts >= maxAttempts) {
          console.warn('Timeout waiting for map to be ready, proceeding anyway');
          resolve();
        } else {
          setTimeout(checkReady, 500);
        }
      };
      
      checkReady();
    });
  }

  private async addNetworkScreenshot() {
    this.checkPageBreak(120);
    this.addSubtitle('Plan du Réseau');

    try {
      const mapContainer = document.querySelector('#map-container') as HTMLElement;
      if (!mapContainer) {
        this.addText('Carte non trouvée');
        return;
      }

      // Attendre que la carte soit prête
      await this.waitForMapReady();

      // Configuration spéciale pour capturer les éléments SVG de Leaflet
      const canvas = await html2canvas(mapContainer, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#f8f9fa',
        scale: 1,
        width: mapContainer.offsetWidth,
        height: mapContainer.offsetHeight,
        scrollX: 0,
        scrollY: 0,
        logging: true, // Activer temporairement pour debug
        removeContainer: true,
        foreignObjectRendering: false, // CRUCIAL pour les SVG
        imageTimeout: 15000,
        ignoreElements: (element) => {
          // Exclure seulement les contrôles UI, GARDER tous les SVG
          return element.classList.contains('leaflet-control-container') ||
                 element.classList.contains('leaflet-control') ||
                 element.classList.contains('leaflet-popup') ||
                 (element.classList.contains('absolute') && element.tagName === 'DIV') ||
                 element.id.includes('tooltip') ||
                 element.tagName === 'BUTTON';
        }
      });
      
      const imgData = canvas.toDataURL('image/png', 1.0);
      
      // Ajouter l'image au PDF avec les bonnes proportions
      const pageWidth = 200 - (2 * this.margin);
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      
      // Calculer les dimensions en gardant le ratio exact
      let pdfWidth = pageWidth;
      let pdfHeight = (canvasHeight * pageWidth) / canvasWidth;
      
      // Si l'image est trop haute, ajuster en gardant le ratio
      const maxHeight = 140;
      if (pdfHeight > maxHeight) {
        pdfHeight = maxHeight;
        pdfWidth = (canvasWidth * maxHeight) / canvasHeight;
      }
      
      this.pdf.addImage(imgData, 'PNG', this.margin, this.currentY, pdfWidth, pdfHeight);
      this.currentY += pdfHeight + 10;

      this.addText('Légende: Nœuds sources en cyan (230V) ou magenta (400V), câbles colorés selon la chute de tension');

    } catch (error) {
      console.error('Erreur capture principale:', error);
      
      // Fallback amélioré
      try {
        this.addText('Tentative de capture alternative...');
        
        // Attendre plus longtemps et réessayer avec des options plus simples
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const mapContainer = document.querySelector('#map-container') as HTMLElement;
        if (!mapContainer) {
          throw new Error('Container non trouvé');
        }

        // Utiliser html2canvas pour le fallback
        const canvas = await html2canvas(mapContainer, {
          useCORS: true,
          allowTaint: false,
          backgroundColor: '#ffffff',
          scale: 1,
          logging: false
        });
        
        const imgData = canvas.toDataURL('image/png');
        
        const pageWidth = 200 - (2 * this.margin);
        this.pdf.addImage(imgData, 'PNG', this.margin, this.currentY, pageWidth, 100);
        this.currentY += 110;
        
        this.addText('Capture alternative réussie');
        
      } catch (fallbackError) {
        console.error('Erreur capture alternative:', fallbackError);
        this.addText('⚠ Capture d\'écran non disponible');
        this.addText('Vérifiez que la carte est bien chargée avant de générer le rapport');
        this.currentY += 20;
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