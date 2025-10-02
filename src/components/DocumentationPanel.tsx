import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, Settings, GitCompare } from "lucide-react";
import { SRG2Documentation } from "./SRG2Documentation";
import { EQUI8Documentation } from "./EQUI8Documentation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const DocumentationPanel = () => {
  return (
    <Tabs defaultValue="srg2" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="srg2" className="text-xs">
          <Activity className="h-3 w-3 mr-1" />
          SRG2
        </TabsTrigger>
        <TabsTrigger value="equi8" className="text-xs">
          <Settings className="h-3 w-3 mr-1" />
          EQUI8
        </TabsTrigger>
        <TabsTrigger value="comparison" className="text-xs">
          <GitCompare className="h-3 w-3 mr-1" />
          Comparaison
        </TabsTrigger>
      </TabsList>

      <TabsContent value="srg2" className="mt-4">
        <SRG2Documentation />
      </TabsContent>

      <TabsContent value="equi8" className="mt-4">
        <EQUI8Documentation />
      </TabsContent>

      <TabsContent value="comparison" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitCompare className="h-5 w-5" />
              Comparaison SRG2 vs EQUI8
            </CardTitle>
            <CardDescription>
              Tableau comparatif des deux technologies
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 font-semibold">Critère</th>
                    <th className="text-left p-2 font-semibold">
                      <Badge variant="default" className="bg-blue-500">SRG2</Badge>
                    </th>
                    <th className="text-left p-2 font-semibold">
                      <Badge variant="default" className="bg-green-500">EQUI8</Badge>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="p-2 font-medium">Objectif principal</td>
                    <td className="p-2">Régulation de tension</td>
                    <td className="p-2">Réduction courant neutre</td>
                  </tr>
                  <tr className="border-b bg-muted/30">
                    <td className="p-2 font-medium">Type de réseau</td>
                    <td className="p-2">230V ou 400V</td>
                    <td className="p-2">400V uniquement</td>
                  </tr>
                  <tr className="border-b">
                    <td className="p-2 font-medium">Type d'action</td>
                    <td className="p-2">Variation tension ±7%</td>
                    <td className="p-2">Injection puissance réactive</td>
                  </tr>
                  <tr className="border-b bg-muted/30">
                    <td className="p-2 font-medium">Mode de connexion</td>
                    <td className="p-2">Tous types de nœuds</td>
                    <td className="p-2">MONO 230V (Ph-N) uniquement</td>
                  </tr>
                  <tr className="border-b">
                    <td className="p-2 font-medium">Traitement phases</td>
                    <td className="p-2">Triphasé indépendant (3 régulateurs)</td>
                    <td className="p-2">Triphasé équilibrage global</td>
                  </tr>
                  <tr className="border-b bg-muted/30">
                    <td className="p-2 font-medium">Temporisation</td>
                    <td className="p-2">7 secondes (hystérésis ±2V)</td>
                    <td className="p-2">Instantané</td>
                  </tr>
                  <tr className="border-b">
                    <td className="p-2 font-medium">Puissance max</td>
                    <td className="p-2">85 kVA injection / 100 kVA consommation</td>
                    <td className="p-2">Configurable (ex: 50 kVA)</td>
                  </tr>
                  <tr className="border-b bg-muted/30">
                    <td className="p-2 font-medium">Conditions d'utilisation</td>
                    <td className="p-2">Réseau instable, surtensions/sous-tensions</td>
                    <td className="p-2">Réseau déséquilibré, I_N élevé</td>
                  </tr>
                  <tr className="border-b">
                    <td className="p-2 font-medium">Impact principal</td>
                    <td className="p-2">Stabilité tension</td>
                    <td className="p-2">Réduction échauffement neutre</td>
                  </tr>
                  <tr className="border-b bg-muted/30">
                    <td className="p-2 font-medium">Exemple d'application</td>
                    <td className="p-2">Réseau PV avec injection variable</td>
                    <td className="p-2">Réseau rural avec charges mono déséquilibrées</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 space-y-2">
              <div className="p-3 bg-blue-500/10 rounded border border-blue-500/20">
                <h4 className="font-semibold text-sm mb-1 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-blue-500" />
                  Quand utiliser le SRG2 ?
                </h4>
                <ul className="text-xs space-y-1 ml-4 list-disc">
                  <li>Réseau avec production photovoltaïque</li>
                  <li>Surtensions en bout de ligne (&gt;253V)</li>
                  <li>Sous-tensions en charge (&lt;207V)</li>
                  <li>Variations rapides de tension</li>
                </ul>
              </div>

              <div className="p-3 bg-green-500/10 rounded border border-green-500/20">
                <h4 className="font-semibold text-sm mb-1 flex items-center gap-2">
                  <Settings className="h-4 w-4 text-green-500" />
                  Quand utiliser l'EQUI8 ?
                </h4>
                <ul className="text-xs space-y-1 ml-4 list-disc">
                  <li>Réseau 400V avec nœuds monophasés</li>
                  <li>Courant de neutre élevé (déséquilibre)</li>
                  <li>Échauffement du conducteur neutre</li>
                  <li>Chutes de tension Ph-N différentes</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
};
