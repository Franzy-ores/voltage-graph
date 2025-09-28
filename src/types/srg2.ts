/**
 * Types pour le régulateur SRG2 (Stabilisateur de Réseau de Génération)
 */

export type SRG2Mode = "AUTO" | "MANUEL";
export type SRG2Status = "ACTIF" | "INACTIF" | "DEFAUT" | "MAINTENANCE";

export interface SRG2Config {
  id: string;
  nodeId: string; // Nœud d'installation
  name: string; // Nom du SRG2
  enabled: boolean; // Actif dans la simulation
  
  // Configuration technique
  mode: SRG2Mode;
  tensionConsigne_V: number; // Tension de consigne (V)
  toléranceTension_V: number; // Tolérance ±V
  puissanceMax_kVA: number; // Puissance réactive maximale
  
  // Paramètres de régulation
  gainProportionnel: number; // Gain P du régulateur
  tempsIntegral_s: number; // Temps intégral Ti (secondes)
  seuílActivation_V: number; // Seuil d'activation du SRG2
  
  // Limites de fonctionnement
  tensionMin_V: number; // Tension minimum de fonctionnement
  tensionMax_V: number; // Tension maximum de fonctionnement
  temperatureMax_C: number; // Température maximum de fonctionnement
  
  // État et résultats de simulation
  status?: SRG2Status;
  tensionMesuree_V?: number; // Tension mesurée au point d'installation
  puissanceInjectee_kVAr?: number; // Puissance réactive injectée (-) ou absorbée (+)
  erreurTension_V?: number; // Erreur de tension (consigne - mesurée)
  limitePuissanceAtteinte?: boolean; // True si limite de puissance atteinte
  defautCode?: string; // Code de défaut éventuel
  
  // Historique (pour régulation PI)
  erreurIntegrale?: number; // Somme des erreurs pour l'intégrale
  derniereMesure_V?: number; // Dernière tension mesurée
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

// Paramètres par défaut pour un SRG2
export const DEFAULT_SRG2_CONFIG: Partial<SRG2Config> = {
  mode: "AUTO",
  tensionConsigne_V: 230, // 230V par défaut pour réseau 400V phase-neutre
  toléranceTension_V: 5, // ±5V de tolérance
  puissanceMax_kVA: 50, // 50kVA de puissance réactive max
  gainProportionnel: 2.0, // Gain proportionnel modéré
  tempsIntegral_s: 10, // Temps intégral de 10 secondes
  seuílActivation_V: 10, // Activation si écart > 10V
  tensionMin_V: 180, // Fonctionnement minimum à 180V
  tensionMax_V: 280, // Fonctionnement maximum à 280V
  temperatureMax_C: 70, // Température maximum 70°C
  enabled: true,
  status: "ACTIF"
};