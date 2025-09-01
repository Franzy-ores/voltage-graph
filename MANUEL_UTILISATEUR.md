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
- 🟢 **Vert** : Chute de tension ≤ 3% (conforme)
- 🟡 **Orange** : Chute de tension 3-5% (attention)
- 🔴 **Rouge** : Chute de tension > 5% (non conforme)

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
3. Contenu : schéma, tableaux, calculs détaillés

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

## 📞 Support technique

Pour toute question ou problème :
1. Vérifiez ce manuel en premier lieu
2. Contrôlez la cohérence de vos données
3. Sauvegardez votre projet avant modifications importantes

---

*Application développée pour les professionnels de l'électricité - Conforme aux normes NF C 15-100*