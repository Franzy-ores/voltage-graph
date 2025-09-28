import { Node, Cable } from '@/types/network';

/**
 * Calcule les nœuds alimentés (connectés à une source) dans le réseau
 */
export const getConnectedNodes = (nodes: Node[], cables: Cable[]): Set<string> => {
  const sources = nodes.filter(node => node.isSource);
  const connectedNodes = new Set<string>();
  
  // Ajouter toutes les sources comme connectées
  sources.forEach(source => connectedNodes.add(source.id));
  
  // Parcourir iterativement pour trouver tous les nœuds connectés
  let hasChanged = true;
  while (hasChanged) {
    hasChanged = false;
    cables.forEach(cable => {
      const nodeAConnected = connectedNodes.has(cable.nodeAId);
      const nodeBConnected = connectedNodes.has(cable.nodeBId);
      
      if (nodeAConnected && !nodeBConnected) {
        connectedNodes.add(cable.nodeBId);
        hasChanged = true;
      } else if (nodeBConnected && !nodeAConnected) {
        connectedNodes.add(cable.nodeAId);
        hasChanged = true;
      }
    });
  }
  
  return connectedNodes;
};

/**
 * Calcule les câbles connectés (dont au moins un nœud est alimenté)
 */
export const getConnectedCables = (cables: Cable[], connectedNodes: Set<string>): Cable[] => {
  return cables.filter(cable => 
    connectedNodes.has(cable.nodeAId) || connectedNodes.has(cable.nodeBId)
  );
};