# Manuel Utilisateur - Calcul de Chute de Tension BT

## 📋 Vue d'ensemble

Cette application permet de calculer et d'analyser les chutes de tension dans les réseaux électriques basse tension (BT). Elle offre une interface cartographique intuitive pour concevoir, modéliser et analyser des réseaux électriques avec différents scénarios de charge.

## 🚀 Démarrage rapide

### 1. Création d'un nouveau réseau
- Cliquez sur **"Nouveau Réseau"** dans le menu principal
- Choisissez le système de tension (230V triphasé ou 400V tétraphasé)
- Votre projet est automatiquement initialisé avec un transformateur par défaut

### 2. Première utilisation
1. **Ajoutez des nœuds** : Cliquez sur l'outil "Nœud" puis sur la carte
2. **Connectez les nœuds** : Utilisez l'outil "Câble" pour relier les points
3. **Configurez les charges** : Double-cliquez sur un nœud pour ajouter des consommations
4. **Lancez le calcul** : Les résultats s'affichent automatiquement

## 🛠️ Interface utilisateur

### Menu principal (en haut)
- **Scénario** : Choix entre Prélèvement, Mixte, ou Production
- **Curseurs de foisonnement** : 
  - **Charges** : Pourcentage de la puissance des charges (0-100%)
  - **Productions** : Pourcentage de la puissance PV (0-100%)
- **Affichage tensions** : Active/désactive l'affichage des tensions sur la carte
- **Changement de système** : Bascule entre 230V et 400V
  - ⚡ **Adaptation automatique** : Les équipements de simulation (SRG2, EQUI8) s'adaptent automatiquement au nouveau système

### Barre d'outils (à gauche)
- 🏠 **Nœud** : Ajouter un point de connexion
- 🔌 **Câble** : Connecter deux nœuds
- ✋ **Sélection** : Sélectionner et déplacer des éléments
- 📍 **Adresse** : Rechercher une adresse sur la carte

### Panneau de résultats (à droite)
- **Conformité globale** : Statut du réseau (Conforme/Non conforme)
- **Chute de tension max** : Circuit le plus critique
- **Détails par circuit** : Intensité, chute de tension, pertes
- **Jeu de barres virtuel** : Analyse du transformateur

## ⚡ Types de scénarios

### 🔋 Production (PV max)
- **Charges** : 0% (pas de consommation)
- **Productions** : 100% (injection PV maximale)
- **Usage** : Vérifier les remontées de tension en cas de surproduction

### 🔄 Mixte
- **Charges** : 30% (consommation réduite)
- **Productions** : 100% (injection PV maximale)
- **Usage** : Conditions intermédiaires, autoconsommation partielle

### 📊 Prélèvement (Charge max)
- **Charges** : 30% (consommation normale)
- **Productions** : 0% (pas d'injection PV)
- **Usage** : Conditions de pointe, vérification des chutes de tension

> 💡 **Astuce** : Le choix du scénario ajuste automatiquement les curseurs de foisonnement

## 🏗️ Configuration des éléments

### Nœuds (points de connexion)
**Double-clic sur un nœud** pour configurer :

#### Charges électriques
- **Type de connexion** : Monophasé, triphasé, tétra
- **Puissance** : En kW ou kVA
- **Cos φ** : Facteur de puissance (0.8 à 1.0)
- **Nom** : Identification de la charge

#### Productions photovoltaïques
- **Puissance crête** : En kWc
- **Cos φ** : Généralement 1.0 pour les onduleurs
- **Type de connexion** : Selon le raccordement

### Câbles
**Double-clic sur un câble** pour configurer :
- **Type de câble** : Section et matériau (cuivre/aluminium)
- **Mode de pose** : Aérien ou souterrain
- **Longueur** : Calculée automatiquement ou saisie manuelle

### Transformateur
**Paramètres généraux** → **Configuration transformateur** :
- **Puissance nominale** : En kVA
- **Tension de court-circuit** : En %
- **Rapport X/R** : Réactance/Résistance
- **Cos φ** : Facteur de puissance

## 📊 Lecture des résultats

### Codes couleur sur la carte

**Câbles** :
- 🟢 **Vert** : Chute de tension ≤ 3% (conforme)
- 🟡 **Orange** : Chute de tension 3-5% (attention)
- 🔴 **Rouge** : Chute de tension > 5% (non conforme)

**Badges d'équipements de simulation** :
- 🟢 **Badge vert** : EQUI8 actif sur le nœud
- 🔵 **Badge bleu** : SRG2 actif sur le nœud
- 🟡 **Badge jaune** : Équipement présent mais désactivé

### Panneau de résultats détaillés

#### Conformité globale
- **Conforme** : Tous les circuits respectent les 3%
- **Non conforme** : Au moins un circuit dépasse les 3%

#### Détails par circuit
- **I (A)** : Intensité circulant dans le câble
- **ΔU (%)** : Chute de tension en pourcentage
- **ΔU (V)** : Chute de tension en volts
- **Pertes (W)** : Pertes par effet Joule
- **Longueur** : Distance en mètres

#### Jeu de barres virtuel
- **Tension** : Tension au secondaire du transformateur
- **Intensité** : Courant total au secondaire
- **ΔU** : Variation de tension due au transformateur

## 📁 Gestion des projets

### Sauvegarder un projet
1. Cliquez sur **"Sauvegarder"**
2. Le fichier JSON est téléchargé automatiquement
3. Conservez ce fichier pour vos archives

### Charger un projet existant
1. Cliquez sur **"Charger"**
2. Sélectionnez votre fichier JSON
3. Le projet s'ouvre avec tous ses paramètres

### Exporter un rapport PDF
1. Cliquez sur **"Exporter PDF"**
2. Le rapport complet est généré automatiquement
3. Contenu enrichi :
   - ✅ Schéma du réseau et tableaux de calculs détaillés
   - ✅ **Données de simulation** si le module est actif (EQUI8, SRG2)
   - ✅ **Détails EQUI8** : Réduction I_N, tensions Ph-N, puissances réactives
   - ✅ **Détails SRG2** : Tensions entrée/sortie, états commutateurs, coefficients
   - ✅ **Comparaison baseline vs simulation** : Tableaux avant/après

> 💡 **Astuce** : Pour exporter uniquement les calculs standards (sans simulation), désactivez tous les équipements avant d'exporter le PDF.

## 🔧 Fonctionnalités avancées

### Mise à jour automatique des câbles
- **"Mettre à jour câbles"** : Actualise la base de données des types de câbles
- Ajoute les dernières références normalisées

### Recherche d'adresse
1. Cliquez sur l'outil **"Adresse"**
2. Tapez l'adresse recherchée
3. La carte se centre automatiquement

### Calcul avec tension cible
- Permet de déterminer la section de câble nécessaire
- Pour atteindre une tension spécifique en bout de ligne

## 🔬 Module de Simulation

Le module de simulation vous permet d'ajouter des équipements de compensation et de régulation pour optimiser votre réseau électrique.

### 8.1 Accéder au module simulation

**Où le trouver ?**
1. Double-cliquez sur un nœud du réseau
2. Dans le panneau d'édition, cliquez sur le bouton **"Simulation"**
3. Un panneau latéral droit s'ouvre avec 3 onglets :
   - 🟢 **EQUI8** : Compensateurs de courant de neutre
   - 🔵 **SRG2** : Régulateurs de tension
   - 📖 **Documentation** : Aide contextuelle sur les équipements

### 8.2 EQUI8 - Compensateur de Courant de Neutre

#### Qu'est-ce que l'EQUI8 ?

L'EQUI8 est un dispositif intelligent qui :
- **Réduit le courant dans le conducteur neutre** (I_N) en injectant des puissances réactives
- **Protège contre l'échauffement** du conducteur neutre
- **Équilibre automatiquement** les tensions phase-neutre (Ph-N) entre les phases A, B et C
- **S'adapte en temps réel** aux conditions de charge du réseau

**Bénéfices** :
- Économies sur la section du conducteur neutre
- Réduction des pertes par effet Joule
- Amélioration de la qualité de la tension
- Conformité aux normes de sécurité

#### Comment l'utiliser ?

1. **Ouvrir l'onglet EQUI8** dans le panneau de simulation
2. **Cliquer sur "+ Ajouter"** pour créer un nouveau compensateur
3. **Sélectionner un nœud éligible** dans la liste déroulante
   - Le nœud doit remplir toutes les conditions d'éligibilité (voir ci-dessous)
4. **Configurer les paramètres** :
   - **Puissance max (kVA)** : Limite de puissance réactive disponible (par défaut: 50 kVA)
   - **Seuil I_N (A)** : Courant minimal pour activer le compensateur (par défaut: 10A)
   - **Zph - Phase (Ω)** : Impédance de phase, doit être > 0.15Ω (par défaut: 0.5Ω)
   - **Zn - Neutre (Ω)** : Impédance de neutre, doit être > 0.15Ω (par défaut: 0.2Ω)
5. **Activer le compensateur** en basculant le switch vert
6. **Lancer la simulation** en cliquant sur le bouton **"Simuler"** en bas du panneau

#### Conditions d'utilisation

Pour qu'un EQUI8 puisse fonctionner, **toutes** ces conditions doivent être remplies :

- ✅ **Réseau 400V tétraphasé** (3 phases + neutre)
  - Vérifiez dans Paramètres généraux → Système de tension = "400V tétraphasé"
- ✅ **Nœud monophasé Phase-Neutre** (MONO_230V_PN)
  - Le nœud doit être connecté entre une phase et le neutre
- ✅ **Mode "Monophasé réparti"** activé
  - Allez dans Paramètres généraux → Cochez "Mode monophasé réparti"
- ✅ **Déséquilibre > 0%** configuré
  - Ajustez le curseur "Déséquilibre" dans Paramètres généraux

> ⚠️ **Important** : Si l'EQUI8 apparaît grisé ou désactivé, le panneau affiche des boutons rapides pour activer automatiquement le mode déséquilibré et configurer les paramètres nécessaires.

#### Lecture des résultats EQUI8

Une fois la simulation exécutée, les résultats s'affichent dans des cartes récapitulatives :

**Indicateurs principaux** :
- **I-EQUI8 (A)** : Courant absorbé par l'EQUI8 lui-même
- **Réduction (%)** : Pourcentage de réduction du courant de neutre
  - Exemple : 45% signifie que I_N a été réduit de 45%
- **I_N initial / I_N compensé** : Comparaison avant/après
  - Exemple : 85A → 47A

**Tensions équilibrées** :
- **Ph1-N (V)** : Tension phase A - neutre après compensation
- **Ph2-N (V)** : Tension phase B - neutre après compensation
- **Ph3-N (V)** : Tension phase C - neutre après compensation
- Ces tensions doivent être proches et idéalement autour de 230V

**Puissances réactives injectées** :
- **Q_A (kVAr)** : Puissance réactive injectée sur phase A
- **Q_B (kVAr)** : Puissance réactive injectée sur phase B
- **Q_C (kVAr)** : Puissance réactive injectée sur phase C

**Badges d'état** :
- 🟡 **"Limité par puissance max"** : La compensation demandée dépasse la puissance maximale configurée → envisagez d'augmenter maxPower_kVA
- 🟢 **"Actif"** : L'EQUI8 fonctionne normalement

### 8.3 SRG2 - Régulateur de Tension Triphasé

#### Qu'est-ce que le SRG2 ?

Le SRG2 est un stabilisateur automatique de tension qui :
- **Régule indépendamment chaque phase** (A, B, C) pour maintenir une tension stable
- **Dispose de 5 positions de commutation** par phase (LO2, LO1, Bypass, BO1, BO2)
- **S'adapte automatiquement** à la tension d'entrée avec hystérésis pour éviter les oscillations
- **Vise à maintenir 230V** stable sur chaque phase en sortie

**Applications** :
- Compensation des chutes de tension importantes
- Stabilisation en cas de production PV fluctuante
- Amélioration de la qualité de la tension en bout de ligne
- Conformité aux normes EN 50160

#### Types de SRG2

Le type de SRG2 est **automatiquement adapté** au système de tension de votre réseau :

**SRG2-400** (pour réseau 400V tétraphasé) :
- Régulation : **±7% / ±3.5%**
- Seuils par défaut : 246V, 238V, Bypass, 222V, 214V
- Utilisé pour les réseaux avec conducteur neutre

**SRG2-230** (pour réseau 230V triphasé) :
- Régulation : **±6% / ±3%**
- Seuils par défaut : 244V, 236V, Bypass, 224V, 216V
- Utilisé pour les réseaux phase-phase sans neutre

> 💡 **Astuce** : Lors du changement de système de tension (230V ↔ 400V), tous les SRG2 sont automatiquement reconfigurés avec les paramètres appropriés.

#### Comment l'utiliser ?

1. **Ouvrir l'onglet SRG2** dans le panneau de simulation
2. **Cliquer sur "+ Ajouter"** pour créer un nouveau régulateur
3. **Sélectionner un nœud** où installer le SRG2
   - Peut être installé sur n'importe quel nœud du réseau
4. **Configurer les paramètres** (optionnel, les valeurs par défaut sont optimales) :
   - **Seuils de régulation** : LO2, LO1, BO1, BO2 (en Volts)
   - **Coefficients** : Pourcentages d'augmentation/réduction de tension
5. **Activer le SRG2** en basculant le switch vert
6. **Lancer la simulation** en cliquant sur **"Simuler"**

#### Vérification des limites de puissance

Le panneau SRG2 affiche automatiquement les **puissances aval foisonnées** pour chaque régulateur :

**Badges de statut** :
- 🟢 **"Dans les limites"** : Puissance aval OK, le SRG2 peut fonctionner normalement
- 🟡 **"Proche limite (X%)"** : Plus de 80% de la limite atteinte → surveiller
- 🔴 **"Limite dépassée (X%)"** : Plus de 100% de la limite → le SRG2 ne peut pas réguler correctement

**Limites techniques** :
- **Injection max : 85 kVA** (cas production PV > charges en aval)
- **Prélèvement max : 110 kVA** (cas charges > production en aval)

> ⚠️ **Attention** : Si la limite est dépassée, répartissez les charges sur plusieurs départs ou installez plusieurs SRG2 sur le réseau.

#### Lecture des résultats SRG2

**Tensions d'entrée** :
- **Entrée A, B, C (V)** : Tensions mesurées avant régulation
- Permet de voir l'état initial du réseau

**États des commutateurs** :
Chaque phase affiche son état de commutation :
- **LO2** : Baisse forte (-7% ou -6%)
- **LO1** : Baisse modérée (-3.5% ou -3%)
- **BYP** : Bypass, pas de modification (0%)
- **BO1** : Boost modéré (+3.5% ou +3%)
- **BO2** : Boost fort (+7% ou +6%)

**Coefficients appliqués** :
- **Coeff A, B, C (%)** : Pourcentage de correction appliqué sur chaque phase
- Exemple : +7% sur phase A signifie tension augmentée de 7%

**Tensions de sortie** :
- **Sortie A, B, C (V)** : Tensions régulées après traitement par le SRG2
- Objectif : proche de 230V pour chaque phase

**Puissance aval** :
- **Puissance aval (kVA)** : Puissance totale calculée en aval du SRG2
- Comparée aux limites 85/110 kVA

**Badges d'état** :
- 🔴 **"Limite puissance atteinte"** : Dépassement des 85/110 kVA
- 🟢 **"Actif"** : Le SRG2 fonctionne normalement

## 🔄 Mode Déséquilibré

### Qu'est-ce que le mode déséquilibré ?

Le mode déséquilibré permet de modéliser des réseaux réels où :
- Les charges et productions monophasées ne sont **pas réparties uniformément** sur les trois phases
- Il existe un **courant de neutre non nul** (I_N)
- Les tensions phase-neutre (Ph-N) sont **différentes** pour chaque phase

Ce mode est **indispensable** pour utiliser l'EQUI8, car sans déséquilibre, il n'y a pas de courant de neutre à compenser.

### Comment l'activer ?

1. Ouvrir le menu **"Paramètres généraux"** (icône ⚙️ dans le menu principal)
2. Cocher la case **"Mode monophasé réparti"**
3. Ajuster le curseur **"Déséquilibre (%)"** :
   - **0%** = Charges équilibrées parfaitement (33.33% sur chaque phase)
   - **50%** = Déséquilibre modéré
   - **100%** = Déséquilibre maximal (répartition très inégale)

### Répartition des phases

Trois curseurs permettent de définir la distribution manuelle des charges/productions :

- **Phase A (%)** : Pourcentage de puissance sur la phase A
- **Phase B (%)** : Pourcentage de puissance sur la phase B
- **Phase C (%)** : Pourcentage de puissance sur la phase C

> 📌 **Note** : Le total des trois phases doit toujours égaler 100%. Les curseurs s'ajustent automatiquement pour respecter cette contrainte.

### Visualisation

**Sur la carte** :
- Les tensions Ph-N s'affichent différemment pour chaque phase si le mode est activé
- Les nœuds monophasés montrent leur phase de connexion (A, B ou C)

**Dans les résultats** :
- Le **courant de neutre (I_N)** apparaît dans les calculs
- Les tensions **Ph-N** sont affichées individuellement (V_A-N, V_B-N, V_C-N)
- Les déséquilibres de phase sont quantifiés

> 💡 **Astuce - Recentrage automatique** : Lorsque vous quittez le mode plein écran du panneau de résultats (icône œil 👁️), la carte se recentre automatiquement sur votre projet pour vous faciliter la navigation.

## ⚠️ Normes et conformité

### Limites réglementaires
- **Chute de tension max** : 3% selon NF C 15-100
- **Facteur de puissance** : Généralement entre 0.8 et 1.0
- **Sections minimales** : Selon usage et protection

### Cas particuliers
- **Remontée de tension** : En cas de production PV importante
- **Déséquilibre** : Répartition des phases sur les charges monophasées
- **Harmoniques** : Impact des charges non linéaires

## 🐛 Résolution des problèmes

### Circuit non conforme
1. **Vérifiez la section** : Augmentez si nécessaire
2. **Contrôlez la longueur** : Réduisez le chemin si possible
3. **Répartissez les charges** : Équilibrez sur plusieurs départs

### Erreurs de calcul
1. **Vérifiez les connexions** : Tous les nœuds doivent être reliés
2. **Contrôlez les données** : Puissances et sections cohérentes
3. **Rechargez le projet** : En cas d'état incohérent

### Performance
- **Projets volumineux** : Limitez le nombre de nœuds (< 100 recommandé)
- **Calculs lents** : Simplifiez le réseau si nécessaire

### EQUI8 ne s'active pas

Si l'EQUI8 apparaît grisé ou refuse de s'activer :

1. **Vérifier le système de tension** : Doit être en **400V tétraphasé**
   - Menu → Paramètres généraux → Système de tension = "400V tétraphasé"
2. **Vérifier le type de connexion du nœud** : Doit être **MONO_230V_PN**
   - Double-clic sur le nœud → Vérifier "Type de connexion"
3. **Activer le mode monophasé réparti** :
   - Menu → Paramètres généraux → Cocher "Mode monophasé réparti"
4. **Configurer un déséquilibre > 0%** :
   - Ajuster le curseur "Déséquilibre" dans Paramètres généraux
5. **Vérifier les impédances** :
   - Zph (Phase) et Zn (Neutre) doivent être **> 0.15Ω**
   - Configuration dans le panneau EQUI8

> 💡 **Astuce** : Le panneau EQUI8 affiche des boutons d'aide rapide pour activer automatiquement le mode déséquilibré si nécessaire.

### SRG2 affiche "Limite puissance atteinte"

Si le badge rouge de limite de puissance s'affiche :

1. **Vérifier les puissances aval foisonnées** :
   - Consultez l'indicateur dans le panneau SRG2 (en kVA)
2. **Réduire les charges ou productions en aval** :
   - Diminuer la puissance des charges connectées après le SRG2
   - Réduire la puissance PV si en mode injection
3. **Répartir les charges sur plusieurs départs** :
   - Diviser le réseau pour équilibrer les puissances
4. **Installer plusieurs SRG2** :
   - Placer des régulateurs sur plusieurs branches du réseau

> 📌 **Rappel des limites** : Injection max = 85 kVA / Prélèvement max = 110 kVA

### Les résultats de simulation ne s'affichent pas

Si la simulation ne produit pas de résultats :

1. **Vérifier qu'au moins un équipement est activé** :
   - Le switch vert doit être activé sur un EQUI8 ou un SRG2
2. **Cliquer sur "Simuler"** :
   - Bouton en bas du panneau de simulation
3. **Vérifier le badge de convergence** :
   - Doit afficher "Convergé" en vert
4. **Si "Non convergé"** :
   - Simplifier le réseau (moins de nœuds en aval)
   - Ajuster les paramètres des équipements
   - Réduire le déséquilibre (< 30%)

## 📞 Support technique

Pour toute question ou problème :
1. Vérifiez ce manuel en premier lieu
2. Contrôlez la cohérence de vos données
3. Sauvegardez votre projet avant modifications importantes

---

*Application développée pour les professionnels de l'électricité - Conforme aux normes NF C 15-100*