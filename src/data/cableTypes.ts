import { CableType } from '@/types/electrical';

export const defaultCableTypes: CableType[] = [
  {
    id: 'al-25',
    name: 'AL 3x25mm²',
    r12: 1.38,
    x12: 0.091,
    r0: 4.14,
    x0: 0.273,
    material: 'Aluminium'
  },
  {
    id: 'al-35',
    name: 'AL 3x35mm²',
    r12: 0.986,
    x12: 0.087,
    r0: 2.958,
    x0: 0.261,
    material: 'Aluminium'
  },
  {
    id: 'al-50',
    name: 'AL 3x50mm²',
    r12: 0.691,
    x12: 0.083,
    r0: 2.073,
    x0: 0.249,
    material: 'Aluminium'
  },
  {
    id: 'al-70',
    name: 'AL 3x70mm²',
    r12: 0.494,
    x12: 0.080,
    r0: 1.482,
    x0: 0.240,
    material: 'Aluminium'
  },
  {
    id: 'al-95',
    name: 'AL 3x95mm²',
    r12: 0.364,
    x12: 0.077,
    r0: 1.092,
    x0: 0.231,
    material: 'Aluminium'
  },
  {
    id: 'al-120',
    name: 'AL 3x120mm²',
    r12: 0.288,
    x12: 0.075,
    r0: 0.864,
    x0: 0.225,
    material: 'Aluminium'
  },
  {
    id: 'al-150',
    name: 'AL 3x150mm²',
    r12: 0.230,
    x12: 0.073,
    r0: 0.690,
    x0: 0.219,
    material: 'Aluminium'
  },
  {
    id: 'al-185',
    name: 'AL 3x185mm²',
    r12: 0.187,
    x12: 0.071,
    r0: 0.561,
    x0: 0.213,
    material: 'Aluminium'
  },
  {
    id: 'al-240',
    name: 'AL 3x240mm²',
    r12: 0.144,
    x12: 0.069,
    r0: 0.432,
    x0: 0.207,
    material: 'Aluminium'
  }
];