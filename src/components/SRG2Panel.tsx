import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNetworkStore } from "@/store/networkStore";
import { SRG2Config } from "@/types/srg2";
import { NodeSelector } from "@/components/NodeSelector";
import { 
  Zap, 
  Settings, 
  Trash2,
  Plus,
  AlertTriangle,
  CheckCircle,
  Activity
} from "lucide-react";

export const SRG2Panel = () => {
  const {
    currentProject,
    simulationEquipment,
    addSRG2Device,
    removeSRG2Device,
    updateSRG2Device
  } = useNetworkStore();

  if (!currentProject) return null;

  const nodes = currentProject.nodes.filter(n => !n.isSource);

  const SRG2Card = ({ srg2 }: { srg2: SRG2Config }) => {
    const node = currentProject.nodes.find(n => n.id === srg2.nodeId);
    
    const getStatusColor = (status?: string) => {
      switch (status) {
        case "ACTIF": return "bg-green-500";
        case "INACTIF": return "bg-gray-500";
        case "DEFAUT": return "bg-red-500";
        case "MAINTENANCE": return "bg-yellow-500";
        default: return "bg-gray-500";
      }
    };

    const getStatusText = (status?: string) => {
      switch (status) {
        case "ACTIF": return "Actif";
        case "INACTIF": return "Inactif";
        case "DEFAUT": return "Défaut";
        case "MAINTENANCE": return "Maintenance";
        default: return "Inconnu";
      }
    };
    
    return (
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-500" />
              <CardTitle className="text-sm">{srg2.name}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${getStatusColor(srg2.status)}`} />
                <span className="text-xs text-muted-foreground">{getStatusText(srg2.status)}</span>
              </div>
              <Switch
                checked={srg2.enabled}
                onCheckedChange={(enabled) => 
                  updateSRG2Device(srg2.id, { enabled })
                }
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeSRG2Device(srg2.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <CardDescription>
            Nœud: {node?.name || srg2.nodeId} • Mode: {srg2.mode} • Type: {srg2.type || 'Auto'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Mode</Label>
              <Select 
                value={srg2.mode} 
                onValueChange={(mode) => updateSRG2Device(srg2.id, { mode: mode as "AUTO" | "MANUEL" })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">Automatique</SelectItem>
                  <SelectItem value="MANUEL">Manuel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Consigne (230V fixe)</Label>
              <Input
                type="number"
                value={230}
                disabled
                className="h-8 bg-muted"
              />
            </div>
          </div>

          {/* Seuils de régulation */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Seuils de régulation ({srg2.type}):</Label>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <Label className="text-xs">LO2 (V)</Label>
                <Input
                  type="number"
                  value={srg2.seuilLO2_V || 246}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    seuilLO2_V: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">LO1 (V)</Label>
                <Input
                  type="number"
                  value={srg2.seuilLO1_V || 238}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    seuilLO1_V: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">BO1 (V)</Label>
                <Input
                  type="number"
                  value={srg2.seuilBO1_V || 222}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    seuilBO1_V: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">BO2 (V)</Label>
                <Input
                  type="number"
                  value={srg2.seuilBO2_V || 214}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    seuilBO2_V: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
            </div>
          </div>

          {/* Coefficients de régulation */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Coefficients (%):</Label>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <Label className="text-xs">LO2</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={srg2.coefficientLO2 || -7}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    coefficientLO2: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">LO1</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={srg2.coefficientLO1 || -3.5}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    coefficientLO1: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">BO1</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={srg2.coefficientBO1 || 3.5}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    coefficientBO1: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">BO2</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={srg2.coefficientBO2 || 7}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    coefficientBO2: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
            </div>
          </div>

          {/* Limites de puissance */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Injection max (kVA)</Label>
              <Input
                type="number"
                value={srg2.puissanceMaxInjection_kVA || 85}
                onChange={(e) => updateSRG2Device(srg2.id, {
                  puissanceMaxInjection_kVA: Number(e.target.value)
                })}
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Prélèvement max (kVA)</Label>
              <Input
                type="number"
                value={srg2.puissanceMaxPrelevement_kVA || 100}
                onChange={(e) => updateSRG2Device(srg2.id, {
                  puissanceMaxPrelevement_kVA: Number(e.target.value)
                })}
                className="h-8"
              />
            </div>
          </div>

          {/* Résultats de simulation */}
          {srg2.tensionEntree && (
            <div className="bg-muted/50 p-2 rounded">
              <div className="text-xs font-medium mb-1">Résultats de régulation:</div>
              
              {/* Tensions d'entrée */}
              <div className="mb-2">
                <div className="text-xs text-muted-foreground mb-1">Tensions d'entrée:</div>
                <div className="grid grid-cols-3 gap-1 text-xs">
                  <div>A: {srg2.tensionEntree.A.toFixed(1)}V</div>
                  <div>B: {srg2.tensionEntree.B.toFixed(1)}V</div>
                  <div>C: {srg2.tensionEntree.C.toFixed(1)}V</div>
                </div>
              </div>

              {/* États des commutateurs */}
              {srg2.etatCommutateur && (
                <div className="mb-2">
                  <div className="text-xs text-muted-foreground mb-1">États commutateurs:</div>
                  <div className="grid grid-cols-3 gap-1 text-xs">
                    <div>A: <Badge variant="outline" className="text-xs">{srg2.etatCommutateur.A}</Badge></div>
                    <div>B: <Badge variant="outline" className="text-xs">{srg2.etatCommutateur.B}</Badge></div>
                    <div>C: <Badge variant="outline" className="text-xs">{srg2.etatCommutateur.C}</Badge></div>
                  </div>
                </div>
              )}

              {/* Coefficients appliqués */}
              {srg2.coefficientsAppliques && (
                <div className="mb-2">
                  <div className="text-xs text-muted-foreground mb-1">Coefficients:</div>
                  <div className="grid grid-cols-3 gap-1 text-xs">
                    <div>A: {srg2.coefficientsAppliques.A > 0 ? '+' : ''}{srg2.coefficientsAppliques.A.toFixed(1)}%</div>
                    <div>B: {srg2.coefficientsAppliques.B > 0 ? '+' : ''}{srg2.coefficientsAppliques.B.toFixed(1)}%</div>
                    <div>C: {srg2.coefficientsAppliques.C > 0 ? '+' : ''}{srg2.coefficientsAppliques.C.toFixed(1)}%</div>
                  </div>
                </div>
              )}

              {/* Tensions de sortie */}
              {srg2.tensionSortie && (
                <div className="mb-2">
                  <div className="text-xs text-muted-foreground mb-1">Tensions de sortie:</div>
                  <div className="grid grid-cols-3 gap-1 text-xs">
                    <div>A: {srg2.tensionSortie.A.toFixed(1)}V</div>
                    <div>B: {srg2.tensionSortie.B.toFixed(1)}V</div>
                    <div>C: {srg2.tensionSortie.C.toFixed(1)}V</div>
                  </div>
                </div>
              )}

              {/* Contraintes et limitations */}
              {srg2.contraintesSRG230 && (
                <Badge variant="secondary" className="mt-1 text-xs">
                  Contraintes SRG2-230 actives
                </Badge>
              )}
              {srg2.limitePuissanceAtteinte && (
                <Badge variant="destructive" className="mt-1 text-xs">
                  Limite puissance atteinte
                </Badge>
              )}
              {srg2.defautCode && (
                <Badge variant="destructive" className="mt-1 text-xs">
                  Défaut: {srg2.defautCode}
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Régulateurs SRG2</h3>
        <NodeSelector
          nodes={currentProject.nodes}
          onNodeSelected={(nodeId) => addSRG2Device(nodeId)}
          title="Ajouter un SRG2"
          description="Stabilisateur de Réseau de Génération - Régulation de tension automatique"
          trigger={
            <Button size="sm" variant="outline" disabled={!nodes.length}>
              <Plus className="h-3 w-3 mr-1" />
              Ajouter
            </Button>
          }
        />
      </div>

      {simulationEquipment.srg2Devices?.length === 0 ? (
        <Card className="p-4 text-center text-muted-foreground">
          <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Aucun régulateur SRG2</p>
          <p className="text-xs">
            Ajoutez des SRG2 pour la régulation automatique de tension
          </p>
        </Card>
      ) : (
        simulationEquipment.srg2Devices?.map(srg2 => (
          <SRG2Card key={srg2.id} srg2={srg2} />
        ))
      )}
    </div>
  );
};