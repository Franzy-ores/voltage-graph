# Refactoring SRG2 - Architecture modulaire

## Vue d'ensemble

Ce document décrit la refactorisation complète du système de régulation SRG2 pour créer une architecture modulaire et éviter les conflits avec le système existant.

## Objectifs

1. **Modularité** : Créer un module SRG2 indépendant dans `src/utils/SRG2Regulator.ts`
2. **Séparation des responsabilités** : Le SRG2 est traité comme équipement de simulation prioritaire
3. **Élimination des conflits** : Remplacement complet de l'ancien système SRG2 intégré
4. **Intégration propre** : Point d'entrée unique dans `SimulationCalculator`

## Architecture

### Module SRG2Regulator.ts

**Classes principales :**
- `SRG2Regulator` : Logique complète de régulation
- Interfaces : `SRG2Config`, `SRG2Result`, `SRG2State`

**Responsabilités :**
- Calcul des seuils de tension (230V/400V)
- Gestion de l'hystérésis (±2V, 7s délai)
- Validation des limites de puissance
- Application des ratios de transformation
- Propagation aux nœuds downstream

### Intégration SimulationCalculator

**Flux de calcul :**
1. **Calcul de base** : Scénario initial sans équipements
2. **Application SRG2** : Première priorité, modification des tensions
3. **Recalcul réseau** : Avec tensions régulées
4. **Autres équipements** : Compensateurs, régulateurs classiques

**Points clés :**
- SRG2 appliqué AVANT tous les autres équipements
- Recalcul complet du réseau après régulation SRG2
- Stockage du résultat SRG2 dans `SimulationResult`

## Types et interfaces

### Nouveaux types (network.ts)

```typescript
export interface SRG2Config {
  nodeId: string;
  enabled: boolean;
  networkType: '230V' | '400V';
  maxPowerInjection_kVA: number;
  maxPowerConsumption_kVA: number;
}

export interface SRG2Result {
  nodeId: string;
  originalVoltage: number;
  regulatedVoltage: number;
  state: string;
  ratio: number;
  phaseRatios?: { A: number; B: number; C: number };
  powerDownstream_kVA: number;
  isActive: boolean;
  limitReason?: string;
}
```

### Extension Node

```typescript
export interface Node {
  // ... propriétés existantes
  srg2Applied?: boolean;
  srg2State?: string;
  srg2Ratio?: number;
}
```

### Extension SimulationEquipment

```typescript
export interface SimulationEquipment {
  regulators: VoltageRegulator[];
  neutralCompensators: NeutralCompensator[];
  cableUpgrades: CableUpgrade[];
  srg2?: SRG2Config; // Configuration SRG2 optionnelle
}
```

## Logique de régulation

### Seuils de tension

**400V :**
- UL: 416V → LO2 (ratio: 0.93)
- LO1: 408V → LO1 (ratio: 0.965)
- BYP: 392-408V → BYP (ratio: 1.0)
- BO1: 392V → BO1 (ratio: 1.035)
- UB: 384V → BO2 (ratio: 1.07)

**230V :**
- UL: 246V → LO2 (ratio: 0.93)
- LO1: 238V → LO1 (ratio: 0.965)
- BYP: 222-238V → BYP (ratio: 1.0)
- BO1: 222V → BO1 (ratio: 1.035)
- UB: 214V → BO2 (ratio: 1.07)

### Hystérésis et temporisation

- **Hystérésis** : ±2V sur chaque seuil
- **Délai** : 7 secondes entre commutations
- **État WAIT** : Transition temporaire pendant le délai

### Limites de puissance

- **Injection max** : 85 kVA (par défaut)
- **Consommation max** : 100 kVA (par défaut)
- **Validation** : Calculée sur le sous-arbre downstream

## Flux d'exécution

```
1. SimulationCalculator.calculateWithSimulation()
   ↓
2. calculateScenarioWithEquipment()
   ↓
3. Application SRG2 (priorité 1)
   ├── SRG2Regulator.apply()
   ├── Validation puissance
   ├── Calcul état/ratio
   └── applyRegulationToNetwork()
   ↓
4. Recalcul scénario avec nœuds modifiés
   ↓
5. Application autres équipements
   ├── Compensateurs de neutre
   └── Régulateurs classiques
   ↓
6. Retour SimulationResult avec srg2Result
```

## Avantages de cette architecture

1. **Isolation** : Aucun conflit avec l'ancien système SRG2
2. **Testabilité** : Module indépendant, tests unitaires complets
3. **Maintenance** : Code focalisé, responsabilités claires
4. **Extensibilité** : Ajout facile de nouvelles fonctionnalités SRG2
5. **Performance** : Un seul point d'application, pas de double calcul

## Tests

### Tests unitaires (srg2RegulatorIntegration.test.ts)

- Application correcte des seuils 230V/400V
- Respect de l'hystérésis et temporisation
- Validation des limites de puissance
- Intégration avec SimulationCalculator
- Stockage correct dans les nœuds
- Gestion des cas d'erreur

### Scénarios de validation

1. **Tension haute** : 420V → LO2 → 390.6V
2. **Tension basse** : 380V → BO2 → 406.6V
3. **Tension normale** : 400V → BYP → 400V
4. **Dépassement puissance** : Désactivation avec raison
5. **Hystérésis** : Pas de commutation prématurée

## Migration

### Ancien système → Nouveau système

1. **Suppression** : Ancien code SRG2 dans ElectricalCalculator
2. **Remplacement** : Intégration via SimulationEquipment.srg2
3. **Compatibilité** : Interface identique pour l'utilisateur final
4. **Tests** : Validation fonctionnelle complète

### Points d'attention

- Vérifier que l'ancien système est complètement désactivé
- S'assurer de la cohérence des résultats
- Valider les performances (pas de régression)
- Tester tous les cas d'usage existants

## Conclusion

Cette refactorisation apporte une solution propre et maintenable pour la régulation SRG2, éliminant les conflits tout en préservant toutes les fonctionnalités. L'architecture modulaire facilite les évolutions futures et améliore la fiabilité du système.