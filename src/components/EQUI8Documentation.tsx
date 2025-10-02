import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, Zap, CheckCircle, AlertTriangle, TrendingDown } from "lucide-react";

export const EQUI8Documentation = () => {
  return (
    <div className="space-y-4">
      {/* Présentation générale */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-green-500" />
            EQUI8 - Compensateur de Neutre
          </CardTitle>
          <CardDescription>
            Réduction du courant de neutre par injection réactive
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Définition</h4>
            <p className="text-xs text-muted-foreground">
              L'EQUI8 est un compensateur de neutre qui réduit le courant circulant dans le conducteur neutre (I_N) des réseaux triphasés déséquilibrés. Il agit en <strong>injectant des puissances réactives</strong> (Q) calculées automatiquement sur les trois phases.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Problème du courant de neutre</h4>
            <div className="p-3 bg-destructive/10 rounded border border-destructive/20">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="text-xs font-semibold">Conséquences d'un I_N élevé</span>
              </div>
              <ul className="text-xs space-y-1 ml-4 list-disc">
                <li>Échauffement excessif du conducteur neutre</li>
                <li>Chutes de tension Ph-N différentes entre phases</li>
                <li>Pertes énergétiques accrues (effet Joule)</li>
                <li>Vieillissement prématuré des câbles</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Principe de fonctionnement */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Principe de fonctionnement
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Étapes de compensation</h4>
            <div className="space-y-2">
              <div className="p-2 bg-muted/50 rounded text-xs">
                <strong>1. Mesure du courant de neutre initial (I_N)</strong>
                <p className="text-muted-foreground mt-1">
                  Calcul vectoriel: I_N = I_A + I_B + I_C (somme des courants de phase)
                </p>
              </div>
              <div className="p-2 bg-muted/50 rounded text-xs">
                <strong>2. Calcul du déséquilibre des phases</strong>
                <p className="text-muted-foreground mt-1">
                  Analyse des écarts de puissance entre Phase 1, Phase 2 et Phase 3
                </p>
              </div>
              <div className="p-2 bg-muted/50 rounded text-xs">
                <strong>3. Calcul des puissances réactives (Q_A, Q_B, Q_C)</strong>
                <p className="text-muted-foreground mt-1">
                  Détermination des Q nécessaires pour équilibrer les tensions Ph-N
                </p>
              </div>
              <div className="p-2 bg-success/10 rounded text-xs border border-success/20">
                <strong>4. Injection réactive et absorption du courant neutre</strong>
                <p className="text-muted-foreground mt-1">
                  L'EQUI8 injecte les Q calculés → Réduction du I_N
                </p>
              </div>
            </div>
          </div>

          <div className="p-3 bg-muted/30 rounded">
            <h4 className="font-semibold text-sm mb-2">Processus de compensation</h4>
            <div className="text-xs space-y-2">
              <div className="space-y-1">
                <p><strong>1️⃣ Mesure I_N initial</strong> → Calcul vectoriel des courants de phase</p>
                <p>↓</p>
                <p><strong>2️⃣ Analyse déséquilibre</strong> → Écarts entre Ph1, Ph2, Ph3</p>
                <p>↓</p>
                <p><strong>3️⃣ Calcul Q_A, Q_B, Q_C</strong> → Puissances réactives nécessaires</p>
                <p>↓</p>
                <p><strong>4️⃣ Vérification puissance</strong> → Limitée par puissance max ?</p>
                <div className="pl-4 space-y-1">
                  <p>✅ Si disponible → <Badge variant="success">Injection complète</Badge></p>
                  <p>⚠️ Si saturé → <Badge variant="warning">Limitation appliquée</Badge></p>
                </div>
                <p>↓</p>
                <p><strong>5️⃣ Résultat</strong> → Réduction I_N + Équilibrage tensions Ph-N</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Conditions d'éligibilité */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Conditions d'éligibilité
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="p-3 bg-success/10 rounded border border-success/20">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="h-4 w-4 text-success" />
                <span className="text-xs font-semibold">Conditions obligatoires</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="success">✓</Badge>
                  <span>Réseau <strong>400V tétraphasé</strong> (3 phases + neutre)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="success">✓</Badge>
                  <span>Nœud en <strong>MONO 230V (Phase-Neutre)</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="success">✓</Badge>
                  <span>Mode <strong>monophasé réparti</strong> avec déséquilibre &gt; 0%</span>
                </div>
              </div>
            </div>

            <div className="p-3 bg-destructive/10 rounded border border-destructive/20">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="text-xs font-semibold">L'EQUI8 ne fonctionne PAS si:</span>
              </div>
              <ul className="text-xs space-y-1 ml-4 list-disc">
                <li>Réseau 230V monophasé uniquement</li>
                <li>Nœud triphasé équilibré (TRI_400V)</li>
                <li>Mode polyphasé équilibré (pas de déséquilibre)</li>
                <li>Impédances Zph ou Zn &lt; 0.15Ω</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Paramètres de configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Paramètres de configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-3">
            <div className="p-3 bg-muted/50 rounded">
              <h4 className="font-semibold text-sm mb-2">Puissance maximale (kVA)</h4>
              <div className="text-xs space-y-2">
                <p>Limite la puissance réactive totale que l'EQUI8 peut injecter.</p>
                <div className="p-2 bg-muted/50 rounded">
                  <p><strong>Exemple:</strong> 50 kVA</p>
                  <p className="mt-1">Si les Q calculés dépassent cette limite, l'EQUI8 applique une réduction proportionnelle.</p>
                </div>
              </div>
            </div>

            <div className="p-3 bg-muted/50 rounded">
              <h4 className="font-semibold text-sm mb-2">Seuil de déclenchement I_N (A)</h4>
              <div className="text-xs space-y-2">
                <p>Courant de neutre minimal pour activer la compensation.</p>
                <div className="p-2 bg-muted/50 rounded">
                  <p><strong>Exemple:</strong> 10A</p>
                  <p className="mt-1">Si I_N &lt; 10A, l'EQUI8 reste inactif (déséquilibre négligeable).</p>
                </div>
              </div>
            </div>

            <div className="p-3 bg-muted/50 rounded">
              <h4 className="font-semibold text-sm mb-2">Impédances Zph et Zn (Ω)</h4>
              <div className="text-xs space-y-2">
                <div className="p-2 bg-muted/50 rounded">
                  <p><strong>Zph (impédance phase):</strong> Résistance/réactance du conducteur de phase</p>
                  <p className="mt-1">Valeur typique: 0.5Ω</p>
                </div>
                <div className="p-2 bg-muted/50 rounded">
                  <p><strong>Zn (impédance neutre):</strong> Résistance/réactance du conducteur neutre</p>
                  <p className="mt-1">Valeur typique: 0.2Ω</p>
                </div>
                <div className="p-2 bg-warning/10 rounded border border-warning/20 mt-2">
                  <p><strong>⚠️ Contrainte:</strong> Zph et Zn doivent être &gt; 0.15Ω</p>
                  <p className="mt-1">Sinon l'EQUI8 ne peut pas compenser efficacement.</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Résultats mesurés */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            Résultats mesurés
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 bg-muted/50 rounded space-y-2">
            <h4 className="font-semibold text-sm">Exemple de compensation</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 bg-destructive/10 rounded">
                <p className="font-semibold">Avant EQUI8</p>
                <p>I_N initial: <Badge variant="destructive">45.2 A</Badge></p>
                <div className="mt-1 space-y-1">
                  <p>Ph1-N: 218V</p>
                  <p>Ph2-N: 233V</p>
                  <p>Ph3-N: 241V</p>
                </div>
              </div>
              <div className="p-2 bg-success/10 rounded">
                <p className="font-semibold">Après EQUI8</p>
                <p>I_N compensé: <Badge variant="success">12.8 A</Badge></p>
                <div className="mt-1 space-y-1">
                  <p>Ph1-N: 228V</p>
                  <p>Ph2-N: 230V</p>
                  <p>Ph3-N: 232V</p>
                </div>
              </div>
            </div>
            <div className="p-2 bg-success/10 rounded border border-success/20">
              <p className="font-semibold text-sm">Réduction: 71.7%</p>
              <p className="text-muted-foreground mt-1">
                Puissances injectées: Q_A = -12.3 kVAr, Q_B = +5.8 kVAr, Q_C = +6.5 kVAr
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cas d'usage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Cas d'usage typiques
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="p-3 bg-green-500/10 rounded border border-green-500/20">
              <h4 className="font-semibold text-sm mb-1">1. Réseau rural déséquilibré</h4>
              <p className="text-xs text-muted-foreground">
                Charges monophasées réparties de manière inégale sur les 3 phases (ex: pompes, éclairage, chauffage).
              </p>
            </div>
            <div className="p-3 bg-blue-500/10 rounded border border-blue-500/20">
              <h4 className="font-semibold text-sm mb-1">2. Réduction échauffement neutre</h4>
              <p className="text-xs text-muted-foreground">
                Protection du conducteur neutre contre les échauffements dus à un I_N élevé (risque d'incendie).
              </p>
            </div>
            <div className="p-3 bg-purple-500/10 rounded border border-purple-500/20">
              <h4 className="font-semibold text-sm mb-1">3. Amélioration qualité de tension</h4>
              <p className="text-xs text-muted-foreground">
                Harmonisation des tensions Ph-N pour éviter les dysfonctionnements d'équipements sensibles.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
