import { ConnectionType, VoltageSystem, LoadModel, Node } from '@/types/network';

/**
 * Déduit automatiquement le type de connexion d'un nœud basé sur:
 * - Le système de tension du projet (230V ou 400V)
 * - Le modèle de charge du projet (monophasé réparti ou polyphasé équilibré)
 * - Si le nœud est une source (les sources utilisent toujours le type polyphasé du système)
 */
export function getNodeConnectionType(
  voltageSystem: VoltageSystem,
  loadModel: LoadModel = 'polyphase_equilibre',
  isSource = false
): ConnectionType {
  // Les sources gardent toujours leur type par défaut selon le système de tension
  if (isSource) {
    return voltageSystem === 'TRIPHASÉ_230V' ? 'TRI_230V_3F' : 'TÉTRA_3P+N_230_400V';
  }

  if (voltageSystem === 'TRIPHASÉ_230V') {
    return loadModel === 'monophase_reparti' ? 'MONO_230V_PP' : 'TRI_230V_3F';
  } else { // 'TÉTRAPHASÉ_400V'
    return loadModel === 'monophase_reparti' ? 'MONO_230V_PN' : 'TÉTRA_3P+N_230_400V';
  }
}

/**
 * Interface pour les objets qui ont besoin d'un type de connexion calculé
 */
export interface NodeWithConnectionType extends Node {
  connectionType: ConnectionType;
}

/**
 * Ajoute le type de connexion calculé à un nœud
 */
export function addConnectionTypeToNode(
  node: Node,
  voltageSystem: VoltageSystem,
  loadModel: LoadModel = 'polyphase_equilibre'
): NodeWithConnectionType {
  return {
    ...node,
    connectionType: getNodeConnectionType(voltageSystem, loadModel, node.isSource)
  };
}

/**
 * Ajoute le type de connexion calculé à une liste de nœuds
 */
export function addConnectionTypeToNodes(
  nodes: Node[],
  voltageSystem: VoltageSystem,
  loadModel: LoadModel = 'polyphase_equilibre'
): NodeWithConnectionType[] {
  return nodes.map(node => addConnectionTypeToNode(node, voltageSystem, loadModel));
}