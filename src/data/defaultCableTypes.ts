import { CableType } from '@/types/network';

export const defaultCableTypes: CableType[] = [
   {
    id: 'baxb-70',
    label: 'BAXB 95',
    R12_ohm_per_km: 0.519,
    X12_ohm_per_km: 0.11,
    R0_ohm_per_km: 2.515,
    X0_ohm_per_km: 0.257,
    matiere: 'ALUMINIUM',
    posesPermises: ['AÉRIEN']
  },
  {
    id: 'baxb-95',
    label: 'BAXB 95',
    R12_ohm_per_km: 0.383,
    X12_ohm_per_km: 0.104,
    R0_ohm_per_km: 2.379,
    X0_ohm_per_km: 0.263,
    matiere: 'ALUMINIUM',
    posesPermises: ['AÉRIEN']
  },
  {
    id: 'baxb-150',
    label: 'BAXB 150',
    R12_ohm_per_km: 0.244,
    X12_ohm_per_km: 0.098,
    R0_ohm_per_km: 1.805,
    X0_ohm_per_km: 0.258,
    matiere: 'ALUMINIUM',
    posesPermises: ['AÉRIEN']
  },
  {
    id: 'eaxecwb-4x150',
    label: 'EAXeCWB 4x150',
    R12_ohm_per_km: 0.242,
    X12_ohm_per_km: 0.069,
    R0_ohm_per_km: 0.972,
    X0_ohm_per_km: 0.273,
    matiere: 'ALUMINIUM',
    posesPermises: ['SOUTERRAIN']
  }
];