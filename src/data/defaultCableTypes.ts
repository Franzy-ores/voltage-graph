import { CableType } from '@/types/network';

export const defaultCableTypes: CableType[] = [
  {
    id: 'cu-10',
    label: 'Cuivre 10',
    R12_ohm_per_km: 1.83,
    X12_ohm_per_km: 0.09,
    R0_ohm_per_km: 5.49,
    X0_ohm_per_km: 0.27,
    matiere: 'CUIVRE',
    posesPermises: ['AÉRIEN']
  },
  {
    id: 'cu-16',
    label: 'Cuivre 16',
    R12_ohm_per_km: 1.15,
    X12_ohm_per_km: 0.09,
    R0_ohm_per_km: 3.45,
    X0_ohm_per_km: 0.27,
    matiere: 'CUIVRE',
    posesPermises: ['AÉRIEN']
  },
  {
    id: 'cu-25',
    label: 'Cuivre 25',
    R12_ohm_per_km: 0.727,
    X12_ohm_per_km: 0.08,
    R0_ohm_per_km: 2.18,
    X0_ohm_per_km: 0.24,
    matiere: 'CUIVRE',
    posesPermises: ['AÉRIEN']
  },
  {
    id: 'cu-4x35',
    label: 'Cuivre 4x35',
    R12_ohm_per_km: 0.524,
    X12_ohm_per_km: 0.08,
    R0_ohm_per_km: 1.57,
    X0_ohm_per_km: 0.24,
    matiere: 'CUIVRE',
    posesPermises: ['AÉRIEN']
  },
  {
    id: 'cu-50',
    label: 'Cuivre 50',
    R12_ohm_per_km: 0.387,
    X12_ohm_per_km: 0.08,
    R0_ohm_per_km: 1.16,
    X0_ohm_per_km: 0.24,
    matiere: 'CUIVRE',
    posesPermises: ['AÉRIEN']
  },
  {
    id: 'cu-70',
    label: 'Cuivre 70',
    R12_ohm_per_km: 0.268,
    X12_ohm_per_km: 0.07,
    R0_ohm_per_km: 0.80,
    X0_ohm_per_km: 0.21,
    matiere: 'CUIVRE',
    posesPermises: ['AÉRIEN']
  } 
  {
    id: 'baxb-70',
    label: 'BAXB 70',
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