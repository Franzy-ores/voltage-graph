import { useState, useCallback } from 'react';
import { NetworkState, NetworkNode, Cable, CalculationScenario, NetworkConfig } from '@/types/electrical';
import { defaultCableTypes } from '@/data/cableTypes';
import { ElectricalCalculations } from '@/utils/electricalCalculations';

const initialConfig: NetworkConfig = {
  voltage: 400,
  phaseType: 'tétraphasé',
  cosPhi: 0.95
};

const initialState: NetworkState = {
  nodes: [],
  cables: [],
  config: initialConfig,
  selectedTool: 'select',
  selectedScenario: 'mixed',
  calculationResults: {
    consumption: null,
    mixed: null,
    production: null
  }
};

export const useNetworkState = () => {
  const [state, setState] = useState<NetworkState>(initialState);

  const addNode = useCallback((x: number, y: number) => {
    const newNode: NetworkNode = {
      id: `node-${Date.now()}`,
      x,
      y,
      name: `Nœud ${state.nodes.length + 1}`,
      loads: [{ id: `load-${Date.now()}`, power: 5, name: 'Charge' }],
      productions: [{ id: `prod-${Date.now()}`, power: 5, name: 'PV', type: 'PV' }]
    };

    setState(prev => ({
      ...prev,
      nodes: [...prev.nodes, newNode]
    }));
  }, [state.nodes.length]);

  const addCable = useCallback((fromNodeId: string, toNodeId: string, length: number = 100) => {
    const newCable: Cable = {
      id: `cable-${Date.now()}`,
      fromNodeId,
      toNodeId,
      type: defaultCableTypes[0],
      length
    };

    setState(prev => ({
      ...prev,
      cables: [...prev.cables, newCable]
    }));
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    setState(prev => ({
      ...prev,
      nodes: prev.nodes.filter(node => node.id !== nodeId),
      cables: prev.cables.filter(cable => 
        cable.fromNodeId !== nodeId && cable.toNodeId !== nodeId
      )
    }));
  }, []);

  const deleteCable = useCallback((cableId: string) => {
    setState(prev => ({
      ...prev,
      cables: prev.cables.filter(cable => cable.id !== cableId)
    }));
  }, []);

  const updateConfig = useCallback((config: Partial<NetworkConfig>) => {
    setState(prev => ({
      ...prev,
      config: { ...prev.config, ...config }
    }));
  }, []);

  const setSelectedTool = useCallback((tool: NetworkState['selectedTool']) => {
    setState(prev => ({ ...prev, selectedTool: tool }));
  }, []);

  const setSelectedScenario = useCallback((scenario: CalculationScenario) => {
    setState(prev => ({ ...prev, selectedScenario: scenario }));
  }, []);

  const calculateAll = useCallback(() => {
    const calculator = new ElectricalCalculations(state.config);
    const cableTypesMap = new Map(defaultCableTypes.map(type => [type.id, type]));

    const consumption = calculator.calculateScenario(
      state.nodes, state.cables, cableTypesMap, 'consumption'
    );
    const mixed = calculator.calculateScenario(
      state.nodes, state.cables, cableTypesMap, 'mixed'
    );
    const production = calculator.calculateScenario(
      state.nodes, state.cables, cableTypesMap, 'production'
    );

    setState(prev => ({
      ...prev,
      calculationResults: { consumption, mixed, production }
    }));
  }, [state.nodes, state.cables, state.config]);

  const newNetwork = useCallback(() => {
    setState(initialState);
  }, []);

  return {
    state,
    addNode,
    addCable,
    deleteNode,
    deleteCable,
    updateConfig,
    setSelectedTool,
    setSelectedScenario,
    calculateAll,
    newNetwork
  };
};