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
            Nœud: {node?.name || srg2.nodeId} • Mode: {srg2.mode}
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
              <Label className="text-xs">Tension consigne (V)</Label>
              <Input
                type="number"
                value={srg2.tensionConsigne_V}
                onChange={(e) => updateSRG2Device(srg2.id, {
                  tensionConsigne_V: Number(e.target.value)
                })}
                className="h-8"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tolérance (±V)</Label>
              <Input
                type="number"
                value={srg2.toléranceTension_V}
                onChange={(e) => updateSRG2Device(srg2.id, {
                  toléranceTension_V: Number(e.target.value)
                })}
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Puissance max (kVA)</Label>
              <Input
                type="number"
                value={srg2.puissanceMax_kVA}
                onChange={(e) => updateSRG2Device(srg2.id, {
                  puissanceMax_kVA: Number(e.target.value)
                })}
                className="h-8"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Gain P</Label>
              <Input
                type="number"
                step="0.1"
                value={srg2.gainProportionnel}
                onChange={(e) => updateSRG2Device(srg2.id, {
                  gainProportionnel: Number(e.target.value)
                })}
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Ti (s)</Label>
              <Input
                type="number"
                value={srg2.tempsIntegral_s}
                onChange={(e) => updateSRG2Device(srg2.id, {
                  tempsIntegral_s: Number(e.target.value)
                })}
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Seuil (V)</Label>
              <Input
                type="number"
                value={srg2.seuílActivation_V}
                onChange={(e) => updateSRG2Device(srg2.id, {
                  seuílActivation_V: Number(e.target.value)
                })}
                className="h-8"
              />
            </div>
          </div>

          {/* Résultats de simulation */}
          {srg2.tensionMesuree_V !== undefined && (
            <div className="bg-muted/50 p-2 rounded">
              <div className="text-xs font-medium mb-1">Résultats simulation:</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Tension: {srg2.tensionMesuree_V.toFixed(1)}V</div>
                <div>Q injecté: {srg2.puissanceInjectee_kVAr?.toFixed(1)}kVAr</div>
                <div>Erreur: {srg2.erreurTension_V?.toFixed(1)}V</div>
                <div>Charge: {srg2.puissanceInjectee_kVAr && srg2.puissanceMax_kVA ? 
                  ((Math.abs(srg2.puissanceInjectee_kVAr) / srg2.puissanceMax_kVA) * 100).toFixed(1) : 0}%
                </div>
              </div>
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