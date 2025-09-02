import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Trash2, Plus, Target, Zap, Network } from 'lucide-react';
import { useNetworkStore } from '@/store/networkStore';
import { ConnectionType, VoltageSystem, ClientCharge, ProductionPV, LoadModel } from '@/types/network';
import { getNodeConnectionType } from '@/utils/nodeConnectionType';
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
          clients: [...(selectedNode.clients || [])],
          productions: [...(selectedNode.productions || [])],
          tensionCible: selectedNode.tensionCible || '',
          transformerConfig: selectedNode.isSource ? currentProject?.transformerConfig : undefined
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
          defaultProductionKVA: currentProject.defaultProductionKVA || 5,
          loadModel: currentProject.loadModel ?? 'polyphase_equilibre',
          desequilibrePourcent: currentProject.desequilibrePourcent ?? 0
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
      S_kVA: currentProject?.defaultChargeKVA || 10
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
      S_kVA: currentProject?.defaultProductionKVA || 5
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

  // Calculer le type de connexion actuel du nœud
  const currentConnectionType = selectedNode && currentProject 
    ? getNodeConnectionType(currentProject.voltageSystem, currentProject.loadModel || 'polyphase_equilibre', selectedNode.isSource)
    : undefined;

  return (
    <Sheet open={editPanelOpen && editTarget !== 'simulation'} onOpenChange={closeEditPanel}>
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
                <Label htmlFor="connection-type">Type de connexion (automatique)</Label>
                <div className="p-2 bg-muted rounded text-sm">
                  {currentConnectionType ? (
                    getConnectionTypeOptions(currentProject?.voltageSystem || 'TÉTRAPHASÉ_400V')
                      .find(opt => opt.value === currentConnectionType)?.label || currentConnectionType
                  ) : 'Non défini'}
                </div>
                <p className="text-xs text-muted-foreground">
                  Le type de connexion est déterminé automatiquement selon le système de tension ({currentProject?.voltageSystem}) 
                  et le modèle de charge ({currentProject?.loadModel || 'polyphase_equilibre'}).
                </p>
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

                 {/* Configuration Transformateur et Tension Source */}
                 {selectedNode?.isSource && (
                   <>
                     {/* Configuration du Transformateur */}
                     <Card>
                       <CardHeader className="pb-3">
                         <CardTitle className="text-base flex items-center gap-2">
                           <Zap className="w-4 h-4" />
                           Configuration Transformateur HT1/BT
                         </CardTitle>
                       </CardHeader>
                       <CardContent className="space-y-3">
                         <div className="space-y-2">
                           <Label htmlFor="transformer-rating">Puissance du transformateur</Label>
                           <Select
                             value={formData.transformerConfig?.rating || currentProject?.transformerConfig?.rating}
                             onValueChange={(value) => {
                               const powerMap = {
                                 "160kVA": 160,
                                 "250kVA": 250, 
                                 "400kVA": 400,
                                 "630kVA": 630
                               };
                               const shortCircuitMap = {
                                 "160kVA": 4.0,
                                 "250kVA": 4.0,
                                 "400kVA": 4.5,
                                 "630kVA": 4.5
                               };
                               const nominalVoltage = currentProject?.voltageSystem === "TRIPHASÉ_230V" ? 230 : 400;
                               
                               setFormData({
                                 ...formData,
                                 transformerConfig: {
                                   rating: value,
                                   nominalPower_kVA: powerMap[value as keyof typeof powerMap],
                                   nominalVoltage_V: nominalVoltage,
                                   shortCircuitVoltage_percent: shortCircuitMap[value as keyof typeof shortCircuitMap],
                                   cosPhi: 0.95
                                 }
                               });
                             }}
                           >
                             <SelectTrigger>
                               <SelectValue />
                             </SelectTrigger>
                             <SelectContent>
                               <SelectItem value="160kVA">160 kVA (Ucc: 4.0%)</SelectItem>
                               <SelectItem value="250kVA">250 kVA (Ucc: 4.0%)</SelectItem>
                               <SelectItem value="400kVA">400 kVA (Ucc: 4.5%)</SelectItem>
                               <SelectItem value="630kVA">630 kVA (Ucc: 4.5%)</SelectItem>
                             </SelectContent>
                           </Select>
                           <p className="text-xs text-muted-foreground">
                             Sélectionner la puissance du transformateur HT1/BT. La tension de court-circuit est définie automatiquement.
                           </p>
                         </div>
                       </CardContent>
                     </Card>

                     {/* Tension Source */}
                     <Card>
                       <CardHeader className="pb-3">
                         <CardTitle className="text-base flex items-center gap-2">
                           <Target className="w-4 h-4" />
                           Tension Source
                         </CardTitle>
                       </CardHeader>
                       <CardContent className="space-y-3">
                         <div className="space-y-2">
                           <Label htmlFor="tension-source">Tension source (V)</Label>
                           <Input
                             id="tension-source"
                             type="number"
                             placeholder={`Ex: ${currentProject?.voltageSystem === 'TRIPHASÉ_230V' ? '230' : '400'}`}
                             value={formData.tensionCible || ''}
                             min={currentProject?.voltageSystem === 'TRIPHASÉ_230V' ? 218.5 : 380}
                             max={currentProject?.voltageSystem === 'TRIPHASÉ_230V' ? 241.5 : 420}
                             onChange={(e) => {
                               const value = parseFloat(e.target.value);
                               setFormData({ 
                                 ...formData, 
                                 tensionCible: value || undefined 
                               });
                             }}
                           />
                           <p className="text-xs text-muted-foreground">
                             Tension de la source (±5% max). Par défaut: {currentProject?.voltageSystem === 'TRIPHASÉ_230V' ? '230V' : '400V'}
                           </p>
                         </div>
                       </CardContent>
                     </Card>
                   </>
                 )}

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

              {/* Configuration Modèle de Charge */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Network className="w-4 h-4" />
                    Modèle de Charge
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="load-model">Type de modèle</Label>
                    <Select
                      value={formData.loadModel || 'polyphase_equilibre'}
                      onValueChange={(value: LoadModel) => setFormData({ ...formData, loadModel: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="polyphase_equilibre">
                          Polyphasé équilibré
                        </SelectItem>
                        <SelectItem value="monophase_reparti">
                          Monophasé réparti
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Mode équilibré: calcul simplifié triphasé. Mode réparti: calcul complet par phase avec déséquilibre possible.
                    </p>
                  </div>

                  {formData.loadModel === 'monophase_reparti' && (
                    <div className="space-y-2">
                      <Label htmlFor="desequilibre">Taux de déséquilibre (%)</Label>
                      <Input
                        id="desequilibre"
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={formData.desequilibrePourcent || 0}
                        onChange={(e) => setFormData({ 
                          ...formData, 
                          desequilibrePourcent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0))
                        })}
                      />
                      <p className="text-xs text-muted-foreground">
                        0% = équilibré (33,3% par phase). Plus élevé = plus de charge sur la phase A, moins sur B et C.
                      </p>
                      {formData.desequilibrePourcent > 0 && (
                        <div className="text-xs text-muted-foreground p-2 bg-muted rounded">
                          <strong>Répartition avec {formData.desequilibrePourcent}% :</strong><br />
                          • Phase A : {((1/3) * (1 + (formData.desequilibrePourcent || 0)/100) * 100).toFixed(1)}%<br />
                          • Phase B/C : {((1 - (1/3) * (1 + (formData.desequilibrePourcent || 0)/100))/2 * 100).toFixed(1)}% chacune
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
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