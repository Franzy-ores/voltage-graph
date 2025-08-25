import { CalculationResult, CalculationScenario, Project } from '@/types/network';

export const generateCableDetailsTable = (
  currentResult: CalculationResult,
  currentProject: Project | null
): string => {
  if (!currentResult.cables.length || !currentProject) {
    return '<p>Aucun câble dans le réseau</p>';
  }

  // Générer les lignes du tableau
  const tableRows = currentResult.cables
    .sort((a, b) => {
      const getNumber = (name: string) => {
        const match = name.match(/Câble (\d+)/);
        return match ? parseInt(match[1], 10) : 999999;
      };
      return getNumber(a.name) - getNumber(b.name);
    })
    .map((cable) => {
      // Récupérer les informations du câble depuis le projet
      const projectCable = currentProject.cables.find(c => c.id === cable.id);
      const cableType = currentProject.cableTypes.find(ct => ct.id === projectCable?.typeId);
      
      // Récupérer les nœuds du câble
      const nodeA = currentProject.nodes.find(n => n.id === projectCable?.nodeAId);
      const nodeB = currentProject.nodes.find(n => n.id === projectCable?.nodeBId);
      
      // Déterminer quel nœud est la source et lequel est l'aval
      const sourceNode = nodeA?.isSource ? nodeA : nodeB?.isSource ? nodeB : nodeA;
      const distalNode = sourceNode === nodeA ? nodeB : nodeA;
      
      // Si aucun des deux n'est source directe, utiliser les tensions cibles
      let actualSourceNode = sourceNode;
      let actualDistalNode = distalNode;
      
      if (!nodeA?.isSource && !nodeB?.isSource) {
        const voltageA = nodeA?.tensionCible || (currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230);
        const voltageB = nodeB?.tensionCible || (currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230);
        
        if (voltageA >= voltageB) {
          actualSourceNode = nodeA;
          actualDistalNode = nodeB;
        } else {
          actualSourceNode = nodeB;
          actualDistalNode = nodeA;
        }
      }
      
      // Calculer les tensions réelles des nœuds
      const baseVoltage = currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230;
      
      // Trouver la tension de la source principale
      const mainSourceNode = currentProject.nodes.find(n => n.isSource);
      const sourceVoltage = mainSourceNode?.tensionCible || baseVoltage;
      
      // Tension du nœud source du câble (tension réelle après chutes cumulatives)
      const sourceNodeVoltageDropResult = currentResult.nodeVoltageDrops?.find(nvd => nvd.nodeId === actualSourceNode?.id);
      const sourceCumulativeVoltageDrop = sourceNodeVoltageDropResult?.deltaU_cum_V || 0;
      const sourceNodeVoltage = sourceVoltage - sourceCumulativeVoltageDrop;
      
      // Tension du nœud aval du câble (tension réelle après chutes cumulatives) 
      const distalNodeVoltageDropResult = currentResult.nodeVoltageDrops?.find(nvd => nvd.nodeId === actualDistalNode?.id);
      const distalCumulativeVoltageDrop = distalNodeVoltageDropResult?.deltaU_cum_V || 0;
      const distalNodeVoltage = sourceVoltage - distalCumulativeVoltageDrop;

      // Calculer les charges et productions du nœud aval
      const distalNodeChargesContractuelles = actualDistalNode?.clients.reduce((sum, client) => sum + client.S_kVA, 0) || 0;
      const distalNodeChargesFoisonnees = distalNodeChargesContractuelles * (currentProject.foisonnementCharges / 100);
      const distalNodeProductions = actualDistalNode?.productions.reduce((sum, prod) => sum + prod.S_kVA, 0) || 0;

      // Couleur pour la chute de tension (basée sur tension nominale)
      const nominalVoltage = (actualDistalNode?.connectionType === 'TÉTRA_3P+N_230_400V') ? 400 : 230;
      const nominalDropPercent = Math.abs((cable.voltageDrop_V || 0) / nominalVoltage * 100);
      const colorClass = nominalDropPercent > 10 ? 'color: red; font-weight: bold;' : 
                        nominalDropPercent > 8 ? 'color: orange; font-weight: bold;' : 
                        'color: green; font-weight: bold;';

      return `
        <tr>
          <td style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">${cable.name}</td>
          <td style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">${sourceNodeVoltage.toFixed(0)}</td>
          <td style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">${cableType?.label || '-'}</td>
          <td style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">${cable.length_m?.toFixed(0) || '-'}</td>
          <td style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">${cable.current_A?.toFixed(1) || '-'}</td>
          <td style="padding: 4px; border: 1px solid #ddd; font-size: 10px; ${colorClass}">${cable.voltageDropPercent?.toFixed(2) || '-'}</td>
          <td style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">${cable.losses_kW?.toFixed(3) || '-'}</td>
          <td style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">${distalNodeVoltage.toFixed(0)}</td>
          <td style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">${distalNodeChargesContractuelles.toFixed(1)}</td>
          <td style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">${distalNodeChargesFoisonnees.toFixed(1)}</td>
          <td style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">${distalNodeProductions.toFixed(1)}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <div style="margin: 20px 0;">
      <h3 style="font-size: 14px; font-weight: bold; margin-bottom: 10px;">Détails par Tronçon</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
        <thead>
          <tr style="background-color: #f5f5f5;">
            <th style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">Câble</th>
            <th style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">U dép.(V)</th>
            <th style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">Type</th>
            <th style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">L (m)</th>
            <th style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">I (A)</th>
            <th style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">ΔU (%)</th>
            <th style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">Pertes (kW)</th>
            <th style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">U arr.(V)</th>
            <th style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">Ch. Contr.(kVA)</th>
            <th style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">Ch. Fois.(kVA)</th>
            <th style="padding: 4px; border: 1px solid #ddd; font-size: 10px;">Prod.(kVA)</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  `;
};