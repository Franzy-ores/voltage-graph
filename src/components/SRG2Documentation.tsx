import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Activity, Zap, Settings, TrendingUp, AlertCircle, ChevronDown } from "lucide-react";
import { useState } from "react";

export const SRG2Documentation = () => {
  return (
    <div className="space-y-4">
      {/* Présentation générale */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-500" />
            SRG2 - Stabilisateur de Réseau de Génération
          </CardTitle>
          <CardDescription>
            Régulateur automatique de tension triphasé
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Définition</h4>
            <p className="text-xs text-muted-foreground">
              Le SRG2 est un dispositif de régulation automatique de tension conçu pour maintenir une tension stable de <strong>230V</strong> sur chaque phase indépendamment. Il agit comme un transformateur variable avec 5 positions de commutation par phase.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Modèles disponibles</h4>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 bg-muted/50 rounded">
                <Badge variant="default" className="mb-1">SRG2-400</Badge>
                <div className="text-xs space-y-1">
                  <div>• Réseau: 400V triphasé</div>
                  <div>• Seuils: 246V / 238V / 222V / 214V</div>
                  <div>• Hystérésis: ±2V</div>
                </div>
              </div>
              <div className="p-2 bg-muted/50 rounded">
                <Badge variant="secondary" className="mb-1">SRG2-230</Badge>
                <div className="text-xs space-y-1">
                  <div>• Réseau: 230V monophasé</div>
                  <div>• Seuils: 237V / 232V / 228V / 223V</div>
                  <div>• Hystérésis: ±1V</div>
                </div>
              </div>
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
            <h4 className="font-semibold text-sm">5 positions de commutateur par phase</h4>
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2 bg-red-500/10 rounded">
                <Badge variant="destructive">LO2</Badge>
                <span className="text-xs">Abaisse la tension de <strong>-7%</strong> (coefficient 0.93)</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-orange-500/10 rounded">
                <Badge variant="warning">LO1</Badge>
                <span className="text-xs">Abaisse la tension de <strong>-3.5%</strong> (coefficient 0.965)</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                <Badge variant="outline">BYP</Badge>
                <span className="text-xs">Aucune modification <strong>0%</strong> (coefficient 1.0)</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-blue-500/10 rounded">
                <Badge variant="default">BO1</Badge>
                <span className="text-xs">Élève la tension de <strong>+3.5%</strong> (coefficient 1.035)</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-green-500/10 rounded">
                <Badge variant="success">BO2</Badge>
                <span className="text-xs">Élève la tension de <strong>+7%</strong> (coefficient 1.07)</span>
              </div>
            </div>
          </div>

          <div className="p-3 bg-muted/30 rounded">
            <h4 className="font-semibold text-sm mb-2">Logique de régulation (SRG2-400)</h4>
            <div className="text-xs space-y-2">
              <div className="space-y-1">
                <p>➡️ Si <strong>V_in &gt; 246V</strong> → Position <Badge variant="destructive">LO2</Badge> (-7%)</p>
                <p>➡️ Si <strong>238V &lt; V_in ≤ 246V</strong> → Position <Badge variant="warning">LO1</Badge> (-3.5%)</p>
                <p>➡️ Si <strong>222V ≤ V_in ≤ 238V</strong> → Position <Badge variant="outline">BYP</Badge> (0%)</p>
                <p>➡️ Si <strong>214V ≤ V_in &lt; 222V</strong> → Position <Badge variant="default">BO1</Badge> (+3.5%)</p>
                <p>➡️ Si <strong>V_in &lt; 214V</strong> → Position <Badge variant="success">BO2</Badge> (+7%)</p>
              </div>
              <div className="mt-3 p-2 bg-muted/50 rounded">
                <p className="font-semibold mb-1">Formule de sortie:</p>
                <p><strong>V_out = V_in × coefficient_position</strong></p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Paramètres techniques */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Paramètres techniques
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-3">
            <div className="p-3 bg-muted/50 rounded">
              <h4 className="font-semibold text-sm mb-2">Tension de consigne</h4>
              <div className="text-xs space-y-2">
                <p><strong>Objectif:</strong> Maintenir 230V en sortie</p>
                <p>Le SRG2 sélectionne automatiquement la position optimale pour se rapprocher de cette consigne.</p>
              </div>
            </div>

            <div className="p-3 bg-muted/50 rounded">
              <h4 className="font-semibold text-sm mb-2">Hystérésis et temporisation</h4>
              <div className="text-xs space-y-2">
                <div className="p-2 bg-muted/50 rounded">
                  <p><strong>Hystérésis:</strong> ±2V (SRG2-400) ou ±1V (SRG2-230)</p>
                  <p className="mt-1">Évite les commutations intempestives lorsque la tension oscille autour d'un seuil.</p>
                </div>
                <div className="p-2 bg-muted/50 rounded">
                  <p><strong>Temporisation:</strong> 7 secondes</p>
                  <p className="mt-1">Délai avant changement de position pour filtrer les variations transitoires.</p>
                </div>
              </div>
            </div>

            <div className="p-3 bg-muted/50 rounded">
              <h4 className="font-semibold text-sm mb-2">Limites de puissance</h4>
              <div className="text-xs space-y-2">
                <div className="p-2 bg-green-500/10 rounded border border-green-500/20">
                  <p><strong>Injection max:</strong> 85 kVA</p>
                  <p className="mt-1">Puissance maximale que le SRG2 peut injecter dans le réseau (production).</p>
                </div>
                <div className="p-2 bg-orange-500/10 rounded border border-orange-500/20">
                  <p><strong>Consommation max:</strong> 100 kVA</p>
                  <p className="mt-1">Puissance maximale que le SRG2 peut transiter en mode consommation.</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Exemple de calcul */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Exemple de calcul
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 bg-muted/50 rounded space-y-2">
            <h4 className="font-semibold text-sm">Scénario: Surtension en injection PV</h4>
            <div className="text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span>Tension d'entrée (V_in):</span>
                <Badge variant="destructive">243V</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Seuil dépassé:</span>
                <span>238V → Position <strong>LO1</strong></span>
              </div>
              <div className="flex items-center justify-between">
                <span>Coefficient appliqué:</span>
                <Badge variant="warning">-3.5% (0.965)</Badge>
              </div>
              <div className="h-px bg-border my-2" />
              <div className="flex items-center justify-between font-semibold">
                <span>Tension de sortie (V_out):</span>
                <Badge variant="success">234.5V</Badge>
              </div>
              <p className="text-muted-foreground mt-2">
                Calcul: 243V × 0.965 = 234.5V<br />
                ✅ Tension stabilisée proche de 230V
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cas d'usage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Cas d'usage typiques
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="p-3 bg-blue-500/10 rounded border border-blue-500/20">
              <h4 className="font-semibold text-sm mb-1">1. Réseau avec production PV</h4>
              <p className="text-xs text-muted-foreground">
                Compensation des surtensions causées par l'injection photovoltaïque en milieu de journée (jusqu'à 250V).
              </p>
            </div>
            <div className="p-3 bg-orange-500/10 rounded border border-orange-500/20">
              <h4 className="font-semibold text-sm mb-1">2. Correction bout de ligne</h4>
              <p className="text-xs text-muted-foreground">
                Stabilisation des tensions en fin de réseau où les chutes peuvent atteindre 205V en période de pointe.
              </p>
            </div>
            <div className="p-3 bg-green-500/10 rounded border border-green-500/20">
              <h4 className="font-semibold text-sm mb-1">3. Réseau rural instable</h4>
              <p className="text-xs text-muted-foreground">
                Maintien de la qualité de tension face aux variations importantes dues aux charges agricoles.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
