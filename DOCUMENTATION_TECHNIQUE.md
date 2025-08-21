# Documentation Technique - Calculateur de Chute de Tension

## Vue d'ensemble

Cette application permet de calculer les chutes de tension dans un réseau électrique en créant visuellement des nœuds et des câbles sur une carte interactive, puis en générant des rapports PDF détaillés.

## Architecture

### Technologies utilisées
- **Frontend**: React 18 + TypeScript + Vite
- **UI**: Tailwind CSS + shadcn/ui components
- **Cartographie**: Leaflet + OpenStreetMap
- **État global**: Zustand
- **PDF**: jsPDF + html2canvas
- **Calculs**: Classes TypeScript personnalisées

### Structure des dossiers
```
src/
├── components/           # Composants React
│   ├── ui/              # Composants UI réutilisables (shadcn)
│   ├── MapView.tsx      # Carte interactive principale
│   ├── ResultsPanel.tsx # Panneau des résultats
│   ├── EditPanel.tsx    # Panneau d'édition nœuds/câbles
│   └── ...
├── store/               # Gestion d'état Zustand
│   └── networkStore.ts  # Store principal du réseau
├── types/               # Définitions TypeScript
│   └── network.ts       # Types du réseau électrique
├── utils/               # Utilitaires
│   ├── electricalCalculations.ts  # Moteur de calcul
│   ├── pdfGenerator.ts            # Générateur PDF
│   └── tableGenerator.ts          # Générateur tableaux
├── data/                # Données par défaut
│   └── defaultCableTypes.ts       # Types de câbles
└── pages/               # Pages principales
    └── Index.tsx        # Page principale
```

## Modèle de données

### Types principaux (`src/types/network.ts`)

```typescript
// Système de tension
type VoltageSystem = 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V';

// Types de connexion
type ConnectionType = 'MONO_230V_PN' | 'MONO_230V_PP' | 'TRI_230V_3F' | 'TÉTRA_3P+N_230_400V';

// Scénarios de calcul
type CalculationScenario = 'PRÉLÈVEMENT' | 'MIXTE' | 'PRODUCTION';

// Nœud du réseau
interface Node {
  id: string;
  name: string;
  lat: number;
  lng: number;
  isSource: boolean;
  connectionType: ConnectionType;
  tensionCible?: number;
  clients: ClientCharge[];      // Charges connectées
  productions: ProductionPV[];  // Productions PV connectées
}

// Câble du réseau
interface Cable {
  id: string;
  name: string;
  nodeAId: string;
  nodeBId: string;
  typeId: string;
  coordinates: { lat: number; lng: number }[];
  // Propriétés calculées
  length_m?: number;
  current_A?: number;
  voltageDrop_V?: number;
  voltageDropPercent?: number;
  losses_kW?: number;
}

// Type de câble avec propriétés électriques
interface CableType {
  id: string;
  label: string;
  R12_ohm_per_km: number;   // Résistance phase-phase
  X12_ohm_per_km: number;   // Réactance phase-phase
  R0_ohm_per_km: number;    // Résistance phase-neutre
  X0_ohm_per_km: number;    // Réactance phase-neutre
  I_max_A: number;          // Courant admissible
  poses: string[];          // Modes de pose autorisés
}

// Projet complet
interface Project {
  id: string;
  name: string;
  voltageSystem: VoltageSystem;
  cosPhi: number;
  foisonnementCharges: number;
  foisonnementProductions: number;
  nodes: Node[];
  cables: Cable[];
  cableTypes: CableType[];
  geographicBounds?: any;
}
```

## Moteur de calcul électrique

### Classe `ElectricalCalculator` (`src/utils/electricalCalculations.ts`)

Cette classe implémente les calculs selon les normes électriques françaises :

#### Méthodes principales

```typescript
class ElectricalCalculator {
  // Calcule un scénario complet
  calculateScenario(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario,
    foisonnementCharges: number = 100,
    foisonnementProductions: number = 100
  ): CalculationResult

  // Calcule la distance géodésique entre deux points
  static calculateGeodeticDistance(
    lat1: number, lon1: number, 
    lat2: number, lon2: number
  ): number

  // Calcule la longueur d'un câble à partir de ses coordonnées
  static calculateCableLength(
    coordinates: { lat: number; lng: number }[]
  ): number
}
```

#### Algorithme de calcul

1. **Construction de l'arbre** : Création d'un arbre enraciné depuis la source
2. **Calcul des puissances équivalentes** : Application des scénarios et foisonnements
3. **Calcul des puissances aval** : Somme des charges en aval de chaque câble
4. **Calcul des courants** : `I = S / (U * cos φ * √3)` (triphasé) ou `I = S / (U * cos φ)` (monophasé)
5. **Calcul des chutes de tension** : `ΔU = I * L * (R * cos φ + X * sin φ)`
6. **Cumul des chutes** : Propagation depuis la source vers les extrémités
7. **Vérification EN50160** : Contrôle des seuils ±8% et ±10%

### Formules utilisées

```typescript
// Courant (triphasé)
I_A = (S_kVA * 1000) / (√3 * U_base * cos_φ)

// Courant (monophasé)  
I_A = (S_kVA * 1000) / (U_base * cos_φ)

// Chute de tension
ΔU_V = I_A * L_km * (R_ohm_per_km * cos_φ + X_ohm_per_km * sin_φ) * √3

// Pourcentage de chute
ΔU_percent = (ΔU_V / U_base) * 100

// Pertes Joule
P_losses_kW = I_A² * R_total_ohm / 1000
```

## Gestion d'état (Zustand)

### Store principal (`src/store/networkStore.ts`)

```typescript
interface NetworkState {
  // Projet actuel
  currentProject: Project | null;
  
  // Interface utilisateur
  selectedTool: 'select' | 'addNode' | 'addCable' | 'move';
  selectedNodeId: string | null;
  selectedCableId: string | null;
  selectedCableType: string;
  showVoltages: boolean;
  
  // Calculs
  calculationResults: Record<CalculationScenario, CalculationResult | null>;
  selectedScenario: CalculationScenario;
  
  // Actions
  addNode: (lat: number, lng: number, connectionType: ConnectionType) => void;
  addCable: (nodeAId: string, nodeBId: string, typeId: string, coordinates: any[]) => void;
  updateNode: (nodeId: string, updates: Partial<Node>) => void;
  deleteNode: (nodeId: string) => void;
  deleteCable: (cableId: string) => void;
  calculateNetwork: () => void;
  // ... autres actions
}
```

### Gestion des calculs

Les calculs sont déclenchés automatiquement lors des modifications du réseau :

```typescript
const calculateNetwork = () => {
  if (!currentProject) return;
  
  const calculator = new ElectricalCalculator(currentProject.cosPhi);
  const scenarios: CalculationScenario[] = ['PRÉLÈVEMENT', 'MIXTE', 'PRODUCTION'];
  
  scenarios.forEach(scenario => {
    const result = calculator.calculateScenario(
      currentProject.nodes,
      currentProject.cables,
      currentProject.cableTypes,
      scenario,
      currentProject.foisonnementCharges,
      currentProject.foisonnementProductions
    );
    calculationResults[scenario] = result;
  });
};
```

## Interface cartographique

### Composant `MapView` (`src/components/MapView.tsx`)

#### Fonctionnalités principales

1. **Affichage des nœuds** avec codes couleur selon le type :
   - 🔵 Bleu : Charges seules
   - 🟢 Vert : Productions seules  
   - 🟡 Jaune : Mixte (charges + productions)
   - 🔴 Rouge : Non-conformité EN50160
   - 🟦 Cyan : Source 230V
   - 🟣 Magenta : Source 400V

2. **Tracé de câbles interactif** :
   - Clic sur nœud source → mode routage activé
   - Clics intermédiaires → points du tracé
   - Double-clic ou Entrée → finalisation
   - Échap → annulation

3. **Affichage des tensions** (optionnel) :
   - Tension calculée en temps réel
   - Charges et productions par nœud

#### Gestion des événements

```typescript
// Clic sur la carte
const handleMapClick = (e: L.LeafletMouseEvent) => {
  if (selectedTool === 'addNode' && !routingActive) {
    addNode(e.latlng.lat, e.latlng.lng, 'MONO_230V_PN');
  } else if (routingActive) {
    // Ajouter point intermédiaire au tracé
    routingPointsRef.current = [...routingPointsRef.current, { 
      lat: e.latlng.lat, 
      lng: e.latlng.lng 
    }];
  }
};

// Double-clic : finaliser le routage
const handleMapDoubleClick = (e: L.LeafletMouseEvent) => {
  if (routingActive && routingFromNode) {
    const finalCoords = [...routingPointsRef.current, { 
      lat: e.latlng.lat, 
      lng: e.latlng.lng 
    }];
    addCable(routingFromNode, targetNodeId, selectedCableType, finalCoords);
  }
};
```

## Génération de rapports PDF

### Classe `PDFGenerator` (`src/utils/pdfGenerator.ts`)

#### Structure du rapport

1. **Page de titre** avec date/heure
2. **Résumé global** : charges, productions, pertes, conformité
3. **Comparaison des scénarios** : tableau comparatif
4. **Détails par tronçon** : tableau complet avec :
   - Tensions départ/arrivée de chaque câble
   - Courants, chutes de tension, pertes
   - Charges contractuelles/foisonnées et productions

#### Méthodes principales

```typescript
class PDFGenerator {
  // Génère le rapport complet
  async generateReport(data: PDFData): Promise<void>
  
  // Ajoute le résumé global
  private addGlobalSummary(data: PDFData): void
  
  // Ajoute la comparaison des scénarios  
  private addScenarioComparison(data: PDFData): void
  
  // Ajoute le tableau détaillé (avec capture HTML->image)
  private async addCableDetails(data: PDFData): Promise<void>
}
```

#### Génération du tableau détaillé

Le tableau est généré en HTML puis capturé en image pour préserver la mise en forme :

```typescript
// Générer le HTML du tableau
const tableHTML = generateCableDetailsTable(currentResult, data.project);

// Créer un élément temporaire
const tempDiv = document.createElement('div');
tempDiv.innerHTML = tableHTML;
document.body.appendChild(tempDiv);

// Capturer en image
const canvas = await html2canvas(tempDiv, {
  scale: 2,
  backgroundColor: '#ffffff',
  useCORS: true
});

// Ajouter au PDF
const imgData = canvas.toDataURL('image/png', 1.0);
this.pdf.addImage(imgData, 'PNG', this.margin, this.currentY, imgWidth, imgHeight);
```

## Extensibilité

### Ajouter un nouveau type de câble

1. **Éditer** `src/data/defaultCableTypes.ts`
2. **Ajouter** les caractéristiques électriques :

```typescript
{
  id: "nouveau_cable",
  label: "Nouveau câble XYZ",
  R12_ohm_per_km: 0.xxx,  // Résistance Ω/km
  X12_ohm_per_km: 0.xxx,  // Réactance Ω/km  
  R0_ohm_per_km: 0.xxx,   // Résistance neutre Ω/km
  X0_ohm_per_km: 0.xxx,   // Réactance neutre Ω/km
  I_max_A: xxx,           // Courant admissible A
  poses: ["ENTERRÉ", "AÉRIEN", "SOUS_GAINE"]
}
```

### Ajouter un nouveau scénario de calcul

1. **Étendre** le type `CalculationScenario` dans `src/types/network.ts`
2. **Modifier** la logique dans `ElectricalCalculator.calculateScenario()`
3. **Mettre à jour** l'interface dans `ResultsPanel.tsx`

### Personnaliser les calculs

La classe `ElectricalCalculator` peut être étendue pour :
- Ajouter de nouveaux types de connexion
- Modifier les formules de chute de tension  
- Implémenter d'autres normes (IEC, NEC, etc.)

## Déploiement

### Variables d'environnement

Aucune variable d'environnement n'est requise pour le fonctionnement de base.

### Build de production

```bash
npm run build    # Génère le build optimisé dans dist/
npm run preview  # Prévisualise le build de production
```

### Hébergement

L'application est une SPA (Single Page Application) qui peut être hébergée sur :
- Vercel, Netlify (recommandé)  
- GitHub Pages
- Tout serveur web statique

## Maintenance et debugging

### Console de debug

L'application affiche des logs détaillés dans la console du navigateur :

```typescript
// Exemple de logs de calcul
console.log('=== CALCUL ÉLECTRIQUE ===');
console.log('Scénario:', scenario);
console.log('Nœuds:', nodes.length);
console.log('Câbles:', cables.length);
console.log('Résultat:', result);
```

### Points d'attention

1. **Performance** : Les calculs sont synchrones, limitez à ~50 nœuds
2. **Précision** : Les coordonnées GPS sont arrondies à 6 décimales
3. **Navigateur** : Requiert un navigateur moderne (ES2020+)
4. **Mémoire** : Les projets sont stockés dans localStorage (limite ~5MB)

### Résolution des problèmes courants

| Problème | Cause | Solution |
|----------|-------|----------|
| Calculs incorrects | Mauvais paramètres câble | Vérifier R, X, I_max |
| PDF lent | Tableau trop large | Réduire nombre colonnes |
| Carte non affichée | Problème Leaflet | Vérifier console réseau |
| Projet non sauvé | localStorage plein | Nettoyer les anciens projets |

## Roadmap

### Améliorations prévues

- [ ] Import/export de projets (.json)
- [ ] Calculs de court-circuit
- [ ] Support des transformateurs  
- [ ] API REST pour calculs serveur
- [ ] Mode multi-utilisateurs
- [ ] Historique des modifications (Git-like)

---

## Contacts

Pour questions techniques ou contributions :
- Vérifier la console navigateur pour les erreurs
- Utiliser l'historique Lovable pour revenir à une version stable
- Consulter la documentation des dépendances (Leaflet, jsPDF, etc.)