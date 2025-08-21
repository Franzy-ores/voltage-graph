import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Trash2, Plus, Target } from 'lucide-react';
import { useNetworkStore } from '@/store/networkStore';
import { ConnectionType, VoltageSystem, ClientCharge, ProductionPV } from '@/types/network';
import { toast } from 'sonner';

export const EditPanel = () => {
  const {
    editPanelOpen,
    editTarget,
    closeEditPanel,
    currentProject,
    selectedNodeId,
    selectedCableId,
    updateNode,
    updateCable,
    updateProjectConfig,
    deleteNode,
    deleteCable,
    calculateWithTargetVoltage
  } = useNetworkStore();

  const [formData, setFormData] = useState<any>({});

  const selectedNode = currentProject?.nodes?.find(n => n.id === selectedNodeId);
  const selectedCable = currentProject?.cables?.find(c => c.id === selectedCableId);

  // Initialize form data when panel opens
  useEffect(() => {
    if (editPanelOpen) {
      if (editTarget === 'node' && selectedNode) {
        setFormData({
          name: selectedNode.name,
          connectionType: selectedNode.connectionType,
          clients: [...(selectedNode.clients || [])],
          productions: [...(selectedNode.productions || [])],
          tensionCible: selectedNode.tensionCible || ''
        });
      } else if (editTarget === 'cable' && selectedCable) {
        setFormData({
          name: selectedCable.name,
          typeId: selectedCable.typeId,
          pose: selectedCable.pose
        });
      } else if (editTarget === 'project' && currentProject) {
        setFormData({
          name: currentProject.name,
          voltageSystem: currentProject.voltageSystem,
          cosPhi: currentProject.cosPhi,
          foisonnementCharges: currentProject.foisonnementCharges,
          foisonnementProductions: currentProject.foisonnementProductions,
          defaultChargeKVA: currentProject.defaultChargeKVA || 5,
          defaultProductionKVA: currentProject.defaultProductionKVA || 5
        });
      }
    }
  }, [editPanelOpen, editTarget, selectedNode, selectedCable, currentProject]);

  const handleSave = () => {
    try {
      if (editTarget === 'node' && selectedNodeId) {
        updateNode(selectedNodeId, formData);
        toast.success('Nœud mis à jour');
      } else if (editTarget === 'cable' && selectedCableId) {
        updateCable(selectedCableId, formData);
        toast.success('Câble mis à jour');
      } else if (editTarget === 'project') {
        updateProjectConfig(formData);
        toast.success('Projet mis à jour');
      }
      closeEditPanel();
    } catch (error) {
      toast.error('Erreur lors de la mise à jour');
    }
  };

  const handleDelete = () => {
    if (editTarget === 'node' && selectedNodeId) {
      deleteNode(selectedNodeId);
      toast.success('Nœud supprimé');
    } else if (editTarget === 'cable' && selectedCableId) {
      deleteCable(selectedCableId);
      toast.success('Câble supprimé');
    }
    closeEditPanel();
  };

  const addClient = () => {
    const newClient: ClientCharge = {
      id: `client-${Date.now()}`,
      label: `Charge ${formData.clients.length + 1}`,
      S_kVA: 5
    };
    setFormData({
      ...formData,
      clients: [...formData.clients, newClient]
    });
  };

  const removeClient = (clientId: string) => {
    setFormData({
      ...formData,
      clients: formData.clients.filter((c: ClientCharge) => c.id !== clientId)
    });
  };

  const addProduction = () => {
    const newProduction: ProductionPV = {
      id: `prod-${Date.now()}`,
      label: `PV ${formData.productions.length + 1}`,
      S_kVA: 5
    };
    setFormData({
      ...formData,
      productions: [...formData.productions, newProduction]
    });
  };

  const removeProduction = (prodId: string) => {
    setFormData({
      ...formData,
      productions: formData.productions.filter((p: ProductionPV) => p.id !== prodId)
    });
  };

  const getConnectionTypeOptions = (voltageSystem: VoltageSystem) => {
    const options = {
      'TRIPHASÉ_230V': [
        { value: 'MONO_230V_PP', label: 'Monophasé 230V (2 phases)' },
        { value: 'TRI_230V_3F', label: 'Triphasé 230V (3 fils)' }
      ],
      'TÉTRAPHASÉ_400V': [
        { value: 'MONO_230V_PN', label: 'Monophasé 230V (phase-neutre)' },
        { value: 'TÉTRA_3P+N_230_400V', label: 'Tétraphasé 3P+N (230/400V)' }
      ]
    };
    return options[voltageSystem] || [];
  };

  return (
    <Sheet open={editPanelOpen} onOpenChange={closeEditPanel}>
      <SheetContent className="w-96 overflow-y-auto" side="right">
        <SheetHeader>
          <SheetTitle>
            {editTarget === 'node' && 'Éditer le nœud'}
            {editTarget === 'cable' && 'Éditer le câble'}
            {editTarget === 'project' && 'Paramètres du projet'}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-6 py-6">
          {/* Node editing */}
          {editTarget === 'node' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="node-name">Nom du nœud</Label>
                <Input
                  id="node-name"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="connection-type">Type de connexion</Label>
                <Select
                  value={formData.connectionType}
                  onValueChange={(value) => setFormData({ ...formData, connectionType: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getConnectionTypeOptions(currentProject?.voltageSystem || 'TÉTRAPHASÉ_400V').map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Clients */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between">
                    Charges
                    <Button size="sm" variant="outline" onClick={addClient}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {formData.clients?.map((client: ClientCharge, index: number) => (
                    <div key={client.id} className="flex gap-2 items-end">
                      <div className="flex-1">
                        <Input
                          placeholder="Nom"
                          value={client.label}
                          onChange={(e) => {
                            const updated = [...formData.clients];
                            updated[index].label = e.target.value;
                            setFormData({ ...formData, clients: updated });
                          }}
                        />
                      </div>
                      <div className="w-20">
                        <Input
                          type="number"
                          placeholder="kVA"
                          value={client.S_kVA}
                          onChange={(e) => {
                            const updated = [...formData.clients];
                            updated[index].S_kVA = parseFloat(e.target.value) || 0;
                            setFormData({ ...formData, clients: updated });
                          }}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => removeClient(client.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Productions */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between">
                    Productions PV
                    <Button size="sm" variant="outline" onClick={addProduction}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {formData.productions?.map((prod: ProductionPV, index: number) => (
                    <div key={prod.id} className="flex gap-2 items-end">
                      <div className="flex-1">
                        <Input
                          placeholder="Nom"
                          value={prod.label}
                          onChange={(e) => {
                            const updated = [...formData.productions];
                            updated[index].label = e.target.value;
                            setFormData({ ...formData, productions: updated });
                          }}
                        />
                      </div>
                      <div className="w-20">
                        <Input
                          type="number"
                          placeholder="kVA"
                          value={prod.S_kVA}
                          onChange={(e) => {
                            const updated = [...formData.productions];
                            updated[index].S_kVA = parseFloat(e.target.value) || 0;
                            setFormData({ ...formData, productions: updated });
                          }}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => removeProduction(prod.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                 </CardContent>
               </Card>

               {/* Tension Cible */}
               {!selectedNode?.isSource && (
                 <Card>
                   <CardHeader className="pb-3">
                     <CardTitle className="text-base flex items-center gap-2">
                       <Target className="w-4 h-4" />
                       Tension Cible
                     </CardTitle>
                   </CardHeader>
                   <CardContent className="space-y-3">
                     <div className="space-y-2">
                       <Label htmlFor="tension-cible">Tension cible (V)</Label>
                       <div className="flex gap-2">
                         <Input
                           id="tension-cible"
                           type="number"
                           placeholder="Ex: 230"
                           value={formData.tensionCible || ''}
                           onChange={(e) => setFormData({ 
                             ...formData, 
                             tensionCible: parseFloat(e.target.value) || undefined 
                           })}
                         />
                         {formData.tensionCible && (
                           <Button
                             variant="outline"
                             onClick={() => {
                               if (selectedNodeId && formData.tensionCible) {
                                 calculateWithTargetVoltage(selectedNodeId, formData.tensionCible);
                               }
                             }}
                           >
                             Ajuster
                           </Button>
                         )}
                       </div>
                       <p className="text-xs text-muted-foreground">
                         Ajuste automatiquement le foisonnement des charges pour atteindre cette tension
                       </p>
                     </div>
                   </CardContent>
                 </Card>
               )}
             </>
           )}

          {/* Cable editing */}
          {editTarget === 'cable' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="cable-name">Nom du câble</Label>
                <Input
                  id="cable-name"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cable-type">Type de câble</Label>
                <Select
                  value={formData.typeId}
                  onValueChange={(value) => setFormData({ ...formData, typeId: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currentProject?.cableTypes?.map(type => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.label}
                      </SelectItem>
                    )) || []}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cable-pose">Type de pose</Label>
                <Select
                  value={formData.pose}
                  onValueChange={(value) => setFormData({ ...formData, pose: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currentProject?.cableTypes
                      ?.find(t => t.id === formData.typeId)
                      ?.posesPermises?.map(pose => (
                        <SelectItem key={pose} value={pose}>
                          {pose}
                        </SelectItem>
                      )) || []}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* Project editing */}
          {editTarget === 'project' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="project-name">Nom du projet</Label>
                <Input
                  id="project-name"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="voltage-system">Système de tension</Label>
                <Select
                  value={formData.voltageSystem}
                  onValueChange={(value) => setFormData({ ...formData, voltageSystem: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TRIPHASÉ_230V">Triphasé 230V</SelectItem>
                    <SelectItem value="TÉTRAPHASÉ_400V">Tétraphasé 400V</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cos-phi">Facteur de puissance (cos φ)</Label>
                <Input
                  id="cos-phi"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={formData.cosPhi || 0.95}
                  onChange={(e) => setFormData({ ...formData, cosPhi: parseFloat(e.target.value) || 0.95 })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="foisonnement-charges">Foisonnement charges (%)</Label>
                <Input
                  id="foisonnement-charges"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.foisonnementCharges || 100}
                  onChange={(e) => setFormData({ ...formData, foisonnementCharges: parseFloat(e.target.value) || 100 })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="foisonnement-productions">Foisonnement productions (%)</Label>
                <Input
                  id="foisonnement-productions"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.foisonnementProductions || 100}
                  onChange={(e) => setFormData({ ...formData, foisonnementProductions: parseFloat(e.target.value) || 100 })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="default-charge">Charge par défaut (kVA)</Label>
                <Input
                  id="default-charge"
                  type="number"
                  min="0"
                  step="0.1"
                  value={formData.defaultChargeKVA || 5}
                  onChange={(e) => setFormData({ ...formData, defaultChargeKVA: parseFloat(e.target.value) || 5 })}
                />
                <p className="text-xs text-muted-foreground">
                  Charge appliquée par défaut aux nouveaux nœuds
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="default-production">Production par défaut (kVA)</Label>
                <Input
                  id="default-production"
                  type="number"
                  min="0"
                  step="0.1"
                  value={formData.defaultProductionKVA || 5}
                  onChange={(e) => setFormData({ ...formData, defaultProductionKVA: parseFloat(e.target.value) || 5 })}
                />
                <p className="text-xs text-muted-foreground">
                  Production PV appliquée par défaut aux nouveaux nœuds
                </p>
              </div>
            </>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-4">
            <Button onClick={handleSave} className="flex-1">
              Sauvegarder
            </Button>
            {(editTarget === 'node' || editTarget === 'cable') && (
              <Button variant="destructive" onClick={handleDelete}>
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};