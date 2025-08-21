import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import leafletImage from 'leaflet-image';
import { generateCableDetailsTable } from './tableGenerator';
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

  private async addCableDetails(data: PDFData) {
    this.checkPageBreak(120);
    this.addSubtitle('Détail par Tronçon');

    const currentResult = data.results[data.selectedScenario];
    if (!currentResult) {
      this.addText('Aucun calcul disponible');
      return;
    }

    try {
      // Générer le tableau HTML
      const tableHTML = generateCableDetailsTable(currentResult, data.project);
      
      // Créer un élément temporaire pour calculer la hauteur
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = tableHTML;
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px';
      tempDiv.style.width = '170mm'; // Largeur PDF moins marges
      document.body.appendChild(tempDiv);

      // Capturer le tableau en image
      const canvas = await html2canvas(tempDiv, {
        scale: 2,
        backgroundColor: '#ffffff',
        width: 640, // ~170mm à 96 DPI
        useCORS: true
      });
      
      const imgData = canvas.toDataURL('image/png', 1.0);
      
      // Calculer les dimensions pour le PDF
      const imgWidth = 170; // mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      // Vérifier si on a besoin d'une nouvelle page
      this.checkPageBreak(imgHeight + 10);
      
      // Ajouter l'image au PDF
      this.pdf.addImage(imgData, 'PNG', this.margin, this.currentY, imgWidth, imgHeight);
      this.currentY += imgHeight + 10;
      
      // Nettoyer
      document.body.removeChild(tempDiv);
      
    } catch (error) {
      console.error('Erreur lors de la génération du tableau:', error);
      
      // Fallback: tableau texte simple
      const sortedCables = [...currentResult.cables].sort((a, b) => {
        const numA = parseInt(a.name.match(/\d+/)?.[0] || '999');
        const numB = parseInt(b.name.match(/\d+/)?.[0] || '999');
        return numA - numB;
      });

      // Headers
      const headers = ['Câble', 'U dép.(V)', 'Type', 'L (m)', 'I (A)', 'ΔU (%)', 'Pertes (kW)', 'U arr.(V)'];
      const colWidths = [20, 18, 25, 15, 15, 18, 18, 18];
      let x = this.margin;

      this.pdf.setFont('helvetica', 'bold');
      this.pdf.setFontSize(8);
      headers.forEach((header, i) => {
        this.pdf.text(header, x, this.currentY);
        x += colWidths[i];
      });
      this.currentY += 6;
      this.addLine();

      // Data rows
      this.pdf.setFont('helvetica', 'normal');
      sortedCables.forEach(cable => {
        this.checkPageBreak(8);
        
        // Récupérer les informations du câble depuis le projet
        const projectCable = data.project.cables.find(c => c.id === cable.id);
        const cableType = data.project.cableTypes.find(ct => ct.id === projectCable?.typeId);
        
        // Calculer les tensions (logique simplifiée pour le fallback)
        const baseVoltage = data.project.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230;
        const nodeVoltageDropResult = currentResult.nodeVoltageDrops?.find(nvd => 
          nvd.nodeId === projectCable?.nodeBId || nvd.nodeId === projectCable?.nodeAId
        );
        const distalVoltage = baseVoltage - (nodeVoltageDropResult?.deltaU_cum_V || 0);
        
        x = this.margin;
        const values = [
          cable.name,
          baseVoltage.toFixed(0),
          cableType?.label || '-',
          cable.length_m?.toFixed(0) || '0',
          cable.current_A?.toFixed(1) || '0.0',
          cable.voltageDropPercent?.toFixed(2) || '0.00',
          cable.losses_kW?.toFixed(3) || '0.000',
          distalVoltage.toFixed(0)
        ];
        
        values.forEach((value, i) => {
          this.pdf.text(value, x, this.currentY);
          x += colWidths[i];
        });
        this.currentY += 5;
      });

      this.currentY += 10;
    }
  }

  private async waitForMapReady(): Promise<void> {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 10; // Réduit de 25 à 10
      
      const checkReady = () => {
        attempts++;
        
        const mapContainer = document.querySelector('#map-container');
        const leafletContainer = document.querySelector('#map-container .leaflet-container');
        
        // Vérifier les tuiles de carte (fond de plan)
        const tileImages = document.querySelectorAll('#map-container .leaflet-tile');
        const tilesLoaded = tileImages.length > 0 && Array.from(tileImages).every(img => 
          (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalHeight > 0
        );
        
        // Vérifier les éléments Canvas (câbles)
        const canvasElements = document.querySelectorAll('#map-container canvas');
        const cablesReady = canvasElements.length > 0;
        
        const mapReady = mapContainer && leafletContainer;
        
        console.log(`PDF Wait ${attempts}/${maxAttempts}: Map: ${mapReady}, Tiles: ${tilesLoaded} (${tileImages.length}), Canvas: ${cablesReady} (${canvasElements.length})`);
        
        if (mapReady && tilesLoaded && cablesReady) {
          // Attente réduite de 2s à 500ms
          setTimeout(resolve, 500);
        } else if (attempts >= maxAttempts) {
          console.warn('PDF: Map timeout - proceeding anyway');
          resolve();
        } else {
          setTimeout(checkReady, 300); // Réduit de 800ms à 300ms
        }
      };
      
      checkReady();
    });
  }

  /**
   * Promisifie leaflet-image pour pouvoir utiliser await
   */
  private leafletImagePromise(mapInstance: any): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      leafletImage(mapInstance, (err: any, canvas: HTMLCanvasElement) => {
        if (err) {
          reject(new Error(`leaflet-image error: ${err}`));
        } else if (!canvas) {
          reject(new Error('leaflet-image returned no canvas'));
        } else {
          resolve(canvas);
        }
      });
    });
  }

  /**
   * Ajoute l'image au PDF avec calcul des proportions
   */
  private addImageToPDF(canvas: HTMLCanvasElement, source: string) {
    const imgData = canvas.toDataURL('image/png', 1.0);
    
    // Calculer les dimensions avec les bonnes proportions
    const pageWidth = 200 - (2 * this.margin);
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    
    let pdfWidth = pageWidth;
    let pdfHeight = (canvasHeight * pageWidth) / canvasWidth;
    
    const maxHeight = 140;
    if (pdfHeight > maxHeight) {
      pdfHeight = maxHeight;
      pdfWidth = (canvasWidth * maxHeight) / canvasHeight;
    }
    
    this.pdf.addImage(imgData, 'PNG', this.margin, this.currentY, pdfWidth, pdfHeight);
    this.currentY += pdfHeight + 10;
    this.addText('Légende: Nœuds sources en cyan (230V) ou magenta (400V), câbles colorés selon la chute de tension');
    
    console.log(`Capture réussie avec ${source}`);
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

      // Essayer d'abord avec leaflet-image pour une meilleure capture des tuiles
      const leafletMapInstance = (window as any).globalMap;
      if (leafletMapInstance && typeof leafletImage === 'function') {
        try {
          console.log('Utilisation de leaflet-image pour une capture optimisée');
          const canvas = await this.leafletImagePromise(leafletMapInstance);
          this.addImageToPDF(canvas, 'leaflet-image');
          return; // Succès avec leaflet-image, on sort
        } catch (leafletError) {
          console.warn('Échec leaflet-image, fallback vers html2canvas:', leafletError);
        }
      } else {
        console.warn('leaflet-image non disponible, fallback vers html2canvas');
      }

      // Fallback vers html2canvas avec configuration optimisée pour les tuiles
      console.log('Fallback vers html2canvas');
      const canvas = await html2canvas(mapContainer, {
        useCORS: true,
        allowTaint: true, // CRUCIAL: Permet de capturer les tuiles malgré CORS
        backgroundColor: '#f8f9fa',
        scale: 1,
        width: mapContainer.offsetWidth,
        height: mapContainer.offsetHeight,
        scrollX: 0,
        scrollY: 0,
        logging: false,
        removeContainer: true,
        foreignObjectRendering: true,
        imageTimeout: 10000, // Réduit de 30s à 10s
        proxy: undefined,
        ignoreElements: (element) => {
          return element.classList.contains('leaflet-control-container') ||
                 element.classList.contains('leaflet-control') ||
                 element.classList.contains('leaflet-popup') ||
                 (element.classList.contains('absolute') && element.tagName === 'DIV') ||
                 element.id.includes('tooltip') ||
                 element.tagName === 'BUTTON';
        }
      });
      
      this.addImageToPDF(canvas, 'html2canvas');

    } catch (error) {
      console.error('Erreur capture principale:', error);
      this.addText('⚠ Capture d\'écran non disponible - Tuiles de carte non chargées');
      this.addText('Vérifiez que la carte est bien chargée avant de générer le rapport');
      this.currentY += 20;
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
    await this.addCableDetails(data);

    // Capture d'écran du réseau
    await this.addNetworkScreenshot();

    // Télécharger le PDF
    const fileName = `Rapport_${data.project.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
    this.pdf.save(fileName);
  }
}