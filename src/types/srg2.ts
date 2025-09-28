/**
 * Types pour le régulateur SRG2 (Stabilisateur de Réseau de Génération)
 */

export type SRG2Mode = "AUTO" | "MANUEL";
export type SRG2Status = "ACTIF" | "INACTIF" | "DEFAUT" | "MAINTENANCE";
export type SRG2SwitchState = "LO2" | "LO1" | "BYP" | "BO1" | "BO2";
export type SRG2Type = "SRG2-400" | "SRG2-230"; // 400V phase/neutre ou 230V phase/phase

export interface SRG2Config {
  id: string;
  nodeId: string; // Nœud d'installation
  name: string; // Nom du SRG2
  enabled: boolean; // Actif dans la simulation
  
  // Configuration technique
  mode: SRG2Mode;
  type: SRG2Type; // Type déterminé automatiquement selon voltageSystem
  tensionConsigne_V: number; // Tension de consigne (toujours 230V)
  
  // Seuils de régulation (selon le type)
  seuilLO2_V: number; // Seuil abaissement complet (246V pour SRG2-400, 214V pour SRG2-230)
  seuilLO1_V: number; // Seuil abaissement partiel (238V pour SRG2-400, 231V pour SRG2-230)  
  seuilBO1_V: number; // Seuil augmentation partielle (222V pour SRG2-400, 189V pour SRG2-230)
  seuilBO2_V: number; // Seuil augmentation complète (214V pour SRG2-400, 182V pour SRG2-230)
  
  // Coefficients de régulation par échelon
  coefficientLO2: number; // -7% ou -6%
  coefficientLO1: number; // -3.5% ou -3%
  coefficientBO1: number; // +3.5% ou +3%  
  coefficientBO2: number; // +7% ou +6%
  
  // Hystérésis et temporisation
  hysteresis_V: number; // ±2V d'hystérésis
  temporisation_s: number; // 7s de temporisation
  
  // Limites de puissance
  puissanceMaxInjection_kVA: number; // 85 kVA max injection en aval
  puissanceMaxPrelevement_kVA: number; // 100 kVA max prélèvement en aval
  
  // État et résultats de simulation
  status?: SRG2Status;
  
  // Mesures par phase
  tensionEntree?: {
    A: number; // Tension mesurée côté alimentation phase A
    B: number; // Tension mesurée côté alimentation phase B  
    C: number; // Tension mesurée côté alimentation phase C
  };
  
  // États des commutateurs par phase
  etatCommutateur?: {
    A: SRG2SwitchState;
    B: SRG2SwitchState; 
    C: SRG2SwitchState;
  };
  
  // Coefficients appliqués par phase
  coefficientsAppliques?: {
    A: number; // Coefficient réellement appliqué sur phase A (%)
    B: number; // Coefficient réellement appliqué sur phase B (%)
    C: number; // Coefficient réellement appliqué sur phase C (%)
  };
  
  // Tensions de sortie calculées
  tensionSortie?: {
    A: number; // Tension de sortie phase A
    B: number; // Tension de sortie phase B
    C: number; // Tension de sortie phase C
  };
  
  // Contraintes et limitations
  contraintesSRG230?: boolean; // True si contraintes SRG2-230 actives
  limitePuissanceAtteinte?: boolean; // True si limite de puissance atteinte
  defautCode?: string; // Code de défaut éventuel
}

export interface SRG2SimulationResult {
  srg2Id: string;
  nodeId: string;
  
  // Résultats de régulation
  tensionAvant_V: number; // Tension avant régulation
  tensionApres_V: number; // Tension après régulation
  puissanceReactive_kVAr: number; // Puissance réactive fournie/absorbée
  ameliorationTension_V: number; // Amélioration de tension apportée
  
  // Performance
  erreurRésiduelle_V: number; // Erreur résiduelle après régulation
  efficacite_percent: number; // Efficacité de la régulation (%)
  tauxCharge_percent: number; // Taux de charge du SRG2 (%)
  
  // État du système
  regulationActive: boolean; // True si régulation active
  saturePuissance: boolean; // True si saturé en puissance
  convergence: boolean; // True si régulation convergée
}

// Interface pour les équipements SRG2
export interface SRG2Equipment {
  srg2Devices: SRG2Config[];
}

// Paramètres par défaut pour un SRG2-400 (phase/neutre)
export const DEFAULT_SRG2_400_CONFIG: Partial<SRG2Config> = {
  mode: "AUTO",
  type: "SRG2-400",
  tensionConsigne_V: 230,
  seuilLO2_V: 246, // Abaissement complet
  seuilLO1_V: 238, // Abaissement partiel  
  seuilBO1_V: 222, // Augmentation partielle
  seuilBO2_V: 214, // Augmentation complète
  coefficientLO2: -7, // -7%
  coefficientLO1: -3.5, // -3.5%
  coefficientBO1: 3.5, // +3.5%
  coefficientBO2: 7, // +7%
  hysteresis_V: 2,
  temporisation_s: 7,
  puissanceMaxInjection_kVA: 85,
  puissanceMaxPrelevement_kVA: 100,
  enabled: true,
  status: "ACTIF"
};

// Paramètres par défaut pour un SRG2-230 (phase/phase)  
export const DEFAULT_SRG2_230_CONFIG: Partial<SRG2Config> = {
  mode: "AUTO",
  type: "SRG2-230",
  tensionConsigne_V: 230,
  seuilLO2_V: 244, // Abaissement complet (230V + 6%)
  seuilLO1_V: 237, // Abaissement partiel
  seuilBO1_V: 223, // Augmentation partielle  
  seuilBO2_V: 216, // Augmentation complète (230V - 6%)
  coefficientLO2: -6, // -6%
  coefficientLO1: -3, // -3%
  coefficientBO1: 3, // +3%
  coefficientBO2: 6, // +6%
  hysteresis_V: 2,
  temporisation_s: 7,
  puissanceMaxInjection_kVA: 85,
  puissanceMaxPrelevement_kVA: 100,
  enabled: true,
  status: "ACTIF"
};