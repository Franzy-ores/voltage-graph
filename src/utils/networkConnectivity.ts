import { Node, Cable } from '@/types/network';

/**
 * Calcule les nœuds alimentés (connectés à une source) dans le réseau
 * SRG2 FIX: Enhanced connectivity detection with SRG2 node validation
 */
export const getConnectedNodes = (nodes: Node[], cables: Cable[]): Set<string> => {
  const sources = nodes.filter(node => node.isSource);
  const connectedNodes = new Set<string>();
  
  console.log(`🔗 Connectivity check: ${nodes.length} nodes, ${cables.length} cables, ${sources.length} sources`);
  
  // Ajouter toutes les sources comme connectées
  sources.forEach(source => {
    connectedNodes.add(source.id);
    console.log(`🔌 Source node added: ${source.id}`);
  });
  
  // SRG2 FIX: Track SRG2 nodes specifically during connectivity analysis
  const srg2Nodes = nodes.filter(n => n.srg2Applied || n.tensionCible);
  if (srg2Nodes.length > 0) {
    console.log(`⚡ SRG2 nodes in network: ${srg2Nodes.map(n => n.id).join(', ')}`);
  }
  
  // Parcourir iterativement pour trouver tous les nœuds connectés
  let hasChanged = true;
  let iteration = 0;
  while (hasChanged) {
    hasChanged = false;
    iteration++;
    console.log(`🔄 Connectivity iteration ${iteration}: ${connectedNodes.size} nodes connected so far`);
    
    cables.forEach(cable => {
      const nodeAConnected = connectedNodes.has(cable.nodeAId);
      const nodeBConnected = connectedNodes.has(cable.nodeBId);
      
      if (nodeAConnected && !nodeBConnected) {
        connectedNodes.add(cable.nodeBId);
        hasChanged = true;
        // Log specifically for SRG2 nodes
        const nodeB = nodes.find(n => n.id === cable.nodeBId);
        if (nodeB && (nodeB.srg2Applied || nodeB.tensionCible)) {
          console.log(`⚡ SRG2 node ${cable.nodeBId} connected via cable ${cable.id}`);
        }
      } else if (nodeBConnected && !nodeAConnected) {
        connectedNodes.add(cable.nodeAId);
        hasChanged = true;
        // Log specifically for SRG2 nodes
        const nodeA = nodes.find(n => n.id === cable.nodeAId);
        if (nodeA && (nodeA.srg2Applied || nodeA.tensionCible)) {
          console.log(`⚡ SRG2 node ${cable.nodeAId} connected via cable ${cable.id}`);
        }
      }
    });
  }
  
  // SRG2 FIX: Validate that all SRG2 nodes are properly connected
  const disconnectedSRG2 = srg2Nodes.filter(n => !connectedNodes.has(n.id));
  if (disconnectedSRG2.length > 0) {
    console.error(`❌ Disconnected SRG2 nodes detected: ${disconnectedSRG2.map(n => n.id).join(', ')}`);
  } else if (srg2Nodes.length > 0) {
    console.log(`✅ All ${srg2Nodes.length} SRG2 nodes are properly connected`);
  }
  
  console.log(`✅ Final connectivity result: ${connectedNodes.size}/${nodes.length} nodes connected`);
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