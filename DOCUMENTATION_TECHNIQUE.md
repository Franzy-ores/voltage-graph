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

## 3. Moteur de calcul électrique

### Principe général

Le réseau est supposé radial (arborescent) avec une seule source. Les calculs sont réalisés en régime sinusoïdal établi par une méthode Backward–Forward Sweep phasorielle (nombres complexes), tenant compte du transformateur HT/BT, des impédances R+jX des tronçons et d'un facteur de puissance global cos φ.

- Convention de signe: Charges > 0 kVA (prélèvement), Productions < 0 kVA (injection).
- Foisonnement: appliqué aux charges et productions selon le scénario (PRÉLÈVEMENT, PRODUCTION, MIXTE) et les pourcentages du projet.
- Références de tension: par défaut 230 V mono / 400 V tétra (ligne). Une tension cible source (tensionCible) peut remplacer la référence.

### Modélisation électrique

1) Système de tension et conversions
- Triphasé/ tétraphasé: U_ligne = √3 · U_phase
- Monophasé: U_ligne = U_phase

2) Impédances de câble (par phase sur la longueur L_km)
- Selon le type de connexion du nœud aval du tronçon:
  - MONO_230V_PN: utiliser R0/X0 (phase-neutre)
  - Autres (PP, TRI, TÉTRA): utiliser R12/X12 (phase-phase)
- Z_ph = (R_(·) · L_km) + j (X_(·) · L_km)

3) Transformateur HT/BT (par phase)
- Données: puissance nominale S_nom (kVA), Ucc (%), tension nominale BT U_nom_ligne (V), ratio X/R optionnel.
- Base: Z_base = U_nom_ligne² / (S_nom · 1000)
- |Z_tr| = (Ucc/100) · Z_base ; décomposition R/X via X/R si disponible, sinon R = 0,05 · |Z_tr|, X = √(|Z_tr|² − R²)
- Tension bus source phasorielle: V_bus = V_slack − Z_tr · I_source

### Algorithme Backward–Forward Sweep

Prétraitements
- Construction de l'arbre depuis la source (BFS) → parent/children, ordre postfixé.
- Puissance équivalente par nœud S_eq(n): charges foisonnées − productions foisonnées selon le scénario.
- S_aval(n): somme de S_eq de n et de tous ses descendants.
- Tension initiale: V(n) ← V_slack = U_ref_phase ∠ 0° (U_ref selon connexion/transformateur/tensionCible source).

Boucle itérative (max 100 itérations, tolérance 1e−4 sur |ΔV|/U_ref_phase)
1) Courant d'injection nodal (par phase)
   - S_total(n) = P + jQ avec P = S_kVA · cos φ · 1000, Q = |S_kVA| · sin φ · 1000 · sign(S_kVA)
   - S_phase(n) = S_total(n) / (3 si triphasé, sinon 1)
   - I_inj(n) = conj(S_phase(n) / V(n))
2) Backward (courants de branches)
   - I_branche(u→p) = I_inj(u) + Σ I_branche(descendants de u)
   - I_source_net = I_inj(source) + Σ I_branche(départs)
3) Forward (mises à jour des tensions)
   - V_source_bus = V_slack − Z_tr · I_source_net
   - Pour chaque enfant v de u: V(v) = V(u) − Z_câble · I_branche(u→v)
4) Test de convergence sur la variation maximale de tension phasorielle.

### Calculs par tronçon (résultats)
- Courant RMS: I = |I_branche|
- Chute par phase: ΔV_ph = Z_câble · I_ph ; en ligne: ΔU_ligne = |ΔV_ph| · (√3 si triphasé, sinon 1)
- Pourcentage de chute: ΔU_% = (ΔU_ligne / U_ref) · 100, avec U_ref = tensionCible source si définie, sinon base de la connexion aval.
- Puissance apparente traversante: S_phase = V_amont · conj(I_ph) ; S_kVA = |S_phase| · (3 si tri, sinon 1) / 1000
- Pertes Joule: P_pertes_kW = I² · R_phase · (3 si tri, sinon 1) / 1000

### Évaluation nodale et conformité
- Tension nœud (ligne): U_node = |V(n)| · (√3 si tri, sinon 1)
- Référence d'affichage: U_ref_aff = tensionCible source sinon base de la connexion du nœud
- ΔU_cum_V = U_ref_aff − U_node ; ΔU_cum_% = ΔU_cum_V / U_ref_aff · 100
- Conformité EN 50160 (nominale 230/400 V): normal ≤ 8 %, warning ≤ 10 %, critical > 10 %
- Pire chute absolue (tous nœuds) → maxVoltageDropPercent et statut de conformité global.

### Jeu de barres virtuel et circuits (VirtualBusbar)
- Calculé après convergence, à partir de I_source_net et Z_tr.
- voltage_V = |V_bus| (ligne), current_A = |I_source_net|, netSkVA = charges − productions, deltaU_percent = ΔU_tr/U_ref · 100, losses_kW ≈ I² · R_tr · (3 si tri)/1000.
- Départs (circuits) = enfants directs de la source:
  - circuitId = tronçon source→enfant, subtreeSkVA, direction (prélèvement/injection), current_A (à partir de netSkVA et V_bus)
  - Répartition de ΔU_tr proportionnelle à subtreeSkVA pour information
  - min/max des tensions nœuds du sous-arbre à partir de V(n)
- Numéro de circuit: index du tronçon depuis la source (trié par id) + 1.

### Scénarios et foisonnement
- PRÉLÈVEMENT: S_eq = charges_foisonnées
- PRODUCTION: S_eq = −productions_foisonnées
- MIXTE: S_eq = charges_foisonnées − productions_foisonnées
- Totaux (charges/productions) et statistiques ne considèrent que les nœuds connectés à la source.

### Distances et longueurs
- Longueur d'un câble: somme géodésique des segments (Haversine) sur ses coordonnées → length_m, L_km.

## 4. Module de Simulation

### 4.1 Architecture du module

Le module de simulation étend les capacités de calcul standard en introduisant des équipements de compensation et de régulation qui peuvent être installés sur les nœuds du réseau.

- **SimulationCalculator** : Extension de `ElectricalCalculator` qui intègre la logique de simulation des équipements
- **SimulationEquipment** : Structure dans le store regroupant tous les équipements de simulation (EQUI8, SRG2)
- **simulationResults** : Résultats de calcul séparés qui remplacent `calculationResults` quand la simulation est active
- **Gestion de l'état** : Les équipements peuvent être activés/désactivés individuellement, permettant des comparaisons baseline vs simulation

### 4.2 EQUI8 - Compensateur de Courant de Neutre

#### Principe technique

L'EQUI8 est un dispositif qui réduit le courant dans le conducteur neutre (I_N) en injectant des puissances réactives calculées automatiquement sur les trois phases. Il permet d'équilibrer les tensions phase-neutre et de protéger le conducteur neutre contre l'échauffement.

**Mécanisme de compensation** :
- Mesure du courant de neutre initial I_N = I_A + I_B + I_C (somme vectorielle complexe)
- Calcul des puissances réactives Q_A, Q_B, Q_C nécessaires pour équilibrer les tensions Ph-N
- Injection contrôlée des réactances pour minimiser I_N
- Limitation automatique par la puissance maximale configurée

#### Algorithme de calcul

```
1. Calcul du courant de neutre initial:
   I_N_initial = I_A + I_B + I_C (somme vectorielle)

2. Test du seuil d'activation:
   Si |I_N_initial| < tolerance_A → EQUI8 reste inactif

3. Détermination des puissances réactives:
   Q_A, Q_B, Q_C calculés pour équilibrer V_A-N, V_B-N, V_C-N

4. Limitation par puissance maximale:
   Si √(Q_A² + Q_B² + Q_C²) > maxPower_kVA → réduction proportionnelle
   État: isLimited = true

5. Application de la compensation:
   I_A_compensé = I_A + Q_A / V_A
   I_B_compensé = I_B + Q_B / V_B
   I_C_compensé = I_C + Q_C / V_C
   
6. Nouveau courant de neutre:
   I_N_final = I_A_compensé + I_B_compensé + I_C_compensé
   reductionPercent = (1 - |I_N_final| / |I_N_initial|) × 100
```

#### Conditions d'éligibilité

Pour qu'un EQUI8 puisse être installé et activé sur un nœud, toutes ces conditions doivent être remplies :

1. **Système de tension** : Réseau en 400V tétraphasé (3 phases + neutre)
2. **Type de connexion du nœud** : MONO_230V_PN (monophasé phase-neutre)
3. **Mode de charge** : `loadModel = 'monophase_reparti'` activé dans le projet
4. **Déséquilibre** : `desequilibrePourcent > 0` (présence effective de déséquilibre)
5. **Impédances minimales** : 
   - Zph_Ohm > 0.15Ω (impédance phase)
   - Zn_Ohm > 0.15Ω (impédance neutre)

> ⚠️ **Important** : Un EQUI8 ne peut pas fonctionner en réseau 230V triphasé phase-phase car il n'y a pas de conducteur neutre.

#### Paramètres de configuration

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `maxPower_kVA` | number | 50 | Puissance réactive maximale disponible |
| `tolerance_A` | number | 10 | Seuil minimal de I_N pour activer |
| `Zph_Ohm` | number | 0.5 | Impédance phase (> 0.15Ω) |
| `Zn_Ohm` | number | 0.2 | Impédance neutre (> 0.15Ω) |
| `enabled` | boolean | false | État d'activation |

#### Résultats de simulation

Après simulation, l'EQUI8 produit les résultats suivants :

- **currentIN_A** : Courant de neutre après compensation (A)
- **reductionPercent** : Pourcentage de réduction du I_N (%)
- **tensionsPhN** : Tensions équilibrées {phaseA_V, phaseB_V, phaseC_V}
- **compensationQ_kVAr** : Puissances réactives injectées {Q_A, Q_B, Q_C}
- **isLimited** : Indique si la compensation est limitée par maxPower_kVA
- **currentEqui8_A** : Courant absorbé par l'EQUI8 lui-même

### 4.3 SRG2 - Régulateur de Tension Triphasé

#### Types de SRG2

Le SRG2 est un stabilisateur automatique de tension disponible en deux variantes selon le système de tension du réseau :

**SRG2-400** (pour réseau 400V tétraphasé) :
- **Seuils de commutation** :
  - LO2 : 246V (baisse forte)
  - LO1 : 238V (baisse modérée)
  - Bypass : entre 238V et 222V
  - BO1 : 222V (boost modéré)
  - BO2 : 214V (boost fort)
- **Coefficients de régulation** :
  - LO2 : -7% (réduction tension)
  - LO1 : -3.5%
  - BO1 : +3.5% (augmentation tension)
  - BO2 : +7%
- **Hystérésis** : ±2V (évite les oscillations)

**SRG2-230** (pour réseau 230V triphasé) :
- **Seuils de commutation** :
  - LO2 : 244V
  - LO1 : 236V
  - Bypass : entre 236V et 224V
  - BO1 : 224V
  - BO2 : 216V
- **Coefficients de régulation** :
  - LO2 : -6%
  - LO1 : -3%
  - BO1 : +3%
  - BO2 : +6%
- **Hystérésis** : ±2V

#### Positions de commutation

Chaque phase (A, B, C) peut être dans une des 5 positions indépendamment :

1. **LO2** (Low Output 2) : Tension trop haute → réduction maximale
2. **LO1** (Low Output 1) : Tension haute → réduction modérée
3. **BYP** (Bypass) : Tension nominale → passage direct sans modification
4. **BO1** (Boost Output 1) : Tension basse → augmentation modérée
5. **BO2** (Boost Output 2) : Tension trop basse → augmentation maximale

#### Limites de puissance

Le SRG2 a des limites de puissance aval selon le sens de transit :

- **Injection maximale** : 85 kVA (cas production PV > charges)
- **Prélèvement maximal** : 110 kVA (cas charges > production)

**Calcul de la puissance aval foisonnée** :
```typescript
P_aval = Σ (charges_foisonnées) - Σ (productions_foisonnées)

Si P_aval < 0 : Mode injection, limite 85 kVA
Si P_aval > 0 : Mode prélèvement, limite 110 kVA
```

Le calcul est récursif : toutes les charges et productions des nœuds descendants sont sommées avec les facteurs de foisonnement du scénario actif.

#### Régulation par phase

Chaque phase est régulée indépendamment selon sa propre tension d'entrée :

```
Pour chaque phase (A, B, C):
  1. Lecture U_entrée_phase
  2. Détermination position commutateur selon seuils et hystérésis
  3. Sélection du coefficient correspondant
  4. Calcul U_sortie_phase = U_entrée_phase × (1 + coefficient/100)
```

#### Formule de régulation

La formule générale appliquée à chaque phase est :

```
U_sortie = U_entrée × (1 + coefficient/100)

Exemples:
- Entrée 220V, état BO2 (+7%) → Sortie = 220 × 1.07 = 235.4V
- Entrée 245V, état LO1 (-3.5%) → Sortie = 245 × 0.965 = 236.4V
- Entrée 230V, état BYP (0%) → Sortie = 230V
```

#### Paramètres de configuration

| Paramètre | Type | Description |
|-----------|------|-------------|
| `type` | 'SRG2-400' \| 'SRG2-230' | Type adapté automatiquement au système |
| `seuilLO2_V` | number | Seuil tension pour LO2 |
| `seuilLO1_V` | number | Seuil tension pour LO1 |
| `seuilBO1_V` | number | Seuil tension pour BO1 |
| `seuilBO2_V` | number | Seuil tension pour BO2 |
| `coefficientLO2` | number | Coefficient LO2 (%) |
| `coefficientLO1` | number | Coefficient LO1 (%) |
| `coefficientBO1` | number | Coefficient BO1 (%) |
| `coefficientBO2` | number | Coefficient BO2 (%) |
| `enabled` | boolean | État d'activation |

#### Résultats de simulation

- **tensionEntree** : Tensions d'entrée par phase {A_V, B_V, C_V}
- **tensionSortie** : Tensions de sortie régulées {A_V, B_V, C_V}
- **etatCommutateur** : Positions par phase {A, B, C} (LO2/LO1/BYP/BO1/BO2)
- **coefficientsAppliques** : Pourcentages appliqués {A_pct, B_pct, C_pct}
- **limitePuissanceAtteinte** : Booléen indiquant dépassement 85/110 kVA
- **puissanceAval_kVA** : Puissance totale calculée en aval

### 4.4 Mode Monophasé Réparti avec Déséquilibre

#### Définition du mode

Le mode `monophase_reparti` permet de modéliser des réseaux où les charges et productions monophasées ne sont pas réparties uniformément sur les trois phases, ce qui génère :

- Des tensions phase-neutre différentes pour chaque phase
- Un courant de neutre non nul (I_N)
- Des conditions nécessaires pour l'utilisation de l'EQUI8

**Activation** : `loadModel = 'monophase_reparti'` dans le projet

#### Paramètre de déséquilibre

Le `desequilibrePourcent` (0-100%) quantifie l'écart de répartition :

- **0%** : Charges/productions équilibrées parfaitement sur les 3 phases (33.33% chacune)
- **50%** : Déséquilibre modéré
- **100%** : Déséquilibre maximal (tout sur une phase possible)

**Formule** :
```
desequilibre = |max(phasePercent) - min(phasePercent)| / moyenne
```

#### Répartition des phases

Trois paramètres définissent la distribution sur les phases (total = 100%) :

- `phaseAPercent` : Pourcentage de puissance sur phase A
- `phaseBPercent` : Pourcentage de puissance sur phase B  
- `phaseCPercent` : Pourcentage de puissance sur phase C

**Application** : Ces pourcentages sont appliqués individuellement à chaque nœud monophasé (MONO_230V_PN) pour répartir sa puissance totale sur les phases.

#### Impact sur les calculs électriques

**Tensions phase-neutre** :
```
V_A-N = V_A (tension complexe phase A par rapport au neutre)
V_B-N = V_B (idem phase B)
V_C-N = V_C (idem phase C)

Généralement: |V_A-N| ≠ |V_B-N| ≠ |V_C-N|
```

**Courant de neutre** :
```
I_N = I_A + I_B + I_C (somme vectorielle complexe)

En équilibre parfait: I_N = 0
Avec déséquilibre: I_N ≠ 0 → échauffement conducteur neutre
```

**Activation de l'EQUI8** : Le mode déséquilibré est indispensable pour que l'EQUI8 ait un courant de neutre à compenser.

### 4.5 Adaptation automatique lors du changement de tension

#### Fonction concernée

La fonction `changeVoltageSystem()` dans `networkStore.ts` gère automatiquement l'adaptation de tous les équipements de simulation lors du changement entre 230V et 400V.

#### 230V → 400V (Passage en tétraphasé)

**Adaptations automatiques** :
1. **Nœuds** : Conversion de tous les nœuds selon le nouveau système
2. **SRG2** : Reconfiguration en **SRG2-400**
   ```typescript
   type: 'SRG2-400'
   seuilLO2_V: 246
   seuilLO1_V: 238
   seuilBO1_V: 222
   seuilBO2_V: 214
   coefficientLO2: -7
   coefficientLO1: -3.5
   coefficientBO1: +3.5
   coefficientBO2: +7
   ```
3. **EQUI8** : Conservation de l'état (peuvent être réactivés car neutre disponible)
4. **Transformateur** : Adaptation à 400V nominal

**Notification toast** :
```
"X SRG2 adapté(s) en SRG2-400"
```

#### 400V → 230V (Passage en triphasé)

**Adaptations automatiques** :
1. **Nœuds** : Conversion de tous les nœuds en types 230V
2. **SRG2** : Reconfiguration en **SRG2-230**
   ```typescript
   type: 'SRG2-230'
   seuilLO2_V: 244
   seuilLO1_V: 236
   seuilBO1_V: 224
   seuilBO2_V: 216
   coefficientLO2: -6
   coefficientLO1: -3
   coefficientBO1: +3
   coefficientBO2: +6
   ```
3. **EQUI8** : **Désactivation automatique** (`enabled: false`)
   - Raison : Pas de conducteur neutre en triphasé phase-phase 230V
   - Les EQUI8 restent configurés mais inactifs
4. **Transformateur** : Adaptation à 230V nominal

**Notification toast** :
```
"X SRG2 adapté(s) en SRG2-230 | X EQUI8 désactivé(s) (pas de neutre en 230V)"
```

#### Recalcul automatique

Après adaptation :
1. Appel immédiat de `updateAllCalculations()` pour recalculer le réseau
2. Si des équipements sont actifs (`enabled: true`), appel automatique de `runSimulation()`
3. Mise à jour des résultats dans `simulationResults` ou `calculationResults`

### 4.6 Export PDF avec données de simulation

#### Sélection des résultats

La fonction `handleExportPDF()` dans `TopMenu.tsx` utilise une logique intelligente pour déterminer quels résultats exporter :

```typescript
const activeEquipmentCount = 
  srg2Devices.filter(s => s.enabled).length + 
  neutralCompensators.filter(c => c.enabled).length;

const resultsToUse = (isSimulationActive && activeEquipmentCount > 0)
  ? simulationResults[selectedScenario]
  : calculationResults[selectedScenario];
```

**Règle** : Si au moins un équipement est actif, les `simulationResults` sont utilisés, sinon les `calculationResults` standards.

#### Contenu enrichi du PDF

Lorsque la simulation est active, le PDF intègre :

**1. Résultats de simulation**
- Utilise `simulationResults[scenario]` au lieu de `calculationResults[scenario]`
- Toutes les métriques reflètent l'impact des équipements actifs

**2. Section EQUI8** (pour chaque compensateur actif)
- Identification : Nœud d'installation, puissance max configurée
- Résultats de compensation :
  - Réduction % du courant de neutre
  - I_N initial vs I_N après compensation
  - Tensions Ph-N équilibrées (V_A-N, V_B-N, V_C-N)
  - Puissances réactives injectées (Q_A, Q_B, Q_C)
  - État de limitation si maxPower atteinte

**3. Section SRG2** (pour chaque régulateur actif)
- Identification : Nœud d'installation, type (SRG2-400 ou SRG2-230)
- Tensions d'entrée par phase (V_entrée_A, V_entrée_B, V_entrée_C)
- États des commutateurs (LO2/LO1/BYP/BO1/BO2) par phase
- Coefficients appliqués (%, positifs ou négatifs)
- Tensions de sortie régulées par phase
- Puissance aval et statut de limite (85/110 kVA)

**4. Comparaison baseline vs simulation**
- Tableaux comparatifs pour chaque métrique clé :
  - Chute de tension maximale (avant/après)
  - Pertes totales (avant/après)
  - Conformité globale
  - Gains obtenus

### 4.7 Recentrage automatique de la carte

#### Événement déclenché

Lors de la sortie du mode plein écran du `ResultsPanel`, un événement personnalisé `zoomToProject` est dispatché pour recentrer automatiquement la carte sur le projet.

#### Implémentation

**Fonction** : `toggleResultsPanelFullscreen()` dans `networkStore.ts`

```typescript
if (exiting fullscreen && geographicBounds exist) {
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('zoomToProject', {
      detail: geographicBounds
    }));
  }, 100); // Délai pour mise à jour du DOM
}
```

**Réception** : Le composant `MapView.tsx` écoute cet événement et ajuste la vue Leaflet

**Impact utilisateur** : Après consultation des résultats en plein écran, la carte se repositionne automatiquement sur l'emprise géographique du projet, facilitant la navigation et évitant de chercher manuellement le réseau.

## 5. Gestion d'état (Zustand)

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
  
  // Calculs standards
  calculationResults: Record<CalculationScenario, CalculationResult | null>;
  selectedScenario: CalculationScenario;
  
  // Simulation
  simulationMode: boolean;
  simulationEquipment: SimulationEquipment;
  simulationResults: Record<CalculationScenario, CalculationResult | null>;
  isSimulationActive: boolean;
  
  // Mode déséquilibré
  loadModel?: 'polyphase_equilibre' | 'monophase_reparti';
  desequilibrePourcent?: number;
  
  // Actions standard
  addNode: (lat: number, lng: number, connectionType: ConnectionType) => void;
  addCable: (nodeAId: string, nodeBId: string, typeId: string, coordinates: any[]) => void;
  updateNode: (nodeId: string, updates: Partial<Node>) => void;
  deleteNode: (nodeId: string) => void;
  deleteCable: (cableId: string) => void;
  calculateNetwork: () => void;
  
  // Actions simulation
  toggleSimulationMode: () => void;
  addNeutralCompensator: (nodeId: string) => void;
  updateNeutralCompensator: (id: string, updates: Partial<NeutralCompensator>) => void;
  removeNeutralCompensator: (id: string) => void;
  addSRG2Device: (nodeId: string) => void;
  updateSRG2Device: (id: string, updates: Partial<SRG2Config>) => void;
  removeSRG2Device: (id: string) => void;
  runSimulation: () => void;
  
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

### Fonctionnalités implémentées

- ✅ **Import/export de projets** (.json) → Sauvegarde et chargement complets
- ✅ **Support des transformateurs** → Configuration complète HT/BT avec Ucc, X/R
- ✅ **Module de simulation** → EQUI8, SRG2, mode déséquilibré
- ✅ **Export PDF avancé** → Intégration des résultats de simulation
- ✅ **Adaptation automatique** → SRG2 et EQUI8 lors du changement de tension

### Améliorations prévues

- [ ] Calculs de court-circuit (Icc, pouvoir de coupure)
- [ ] API REST pour calculs serveur côté backend
- [ ] Mode multi-utilisateurs avec collaboration temps réel
- [ ] Historique des modifications (Git-like) avec diff visuel
- [ ] Export vers formats CAO (DXF, DWG)
- [ ] Bibliothèque de réseaux types prédéfinis

---

## Contacts

Pour questions techniques ou contributions :
- Vérifier la console navigateur pour les erreurs
- Utiliser l'historique Lovable pour revenir à une version stable
- Consulter la documentation des dépendances (Leaflet, jsPDF, etc.)
