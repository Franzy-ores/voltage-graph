// Lightweight complex number utilities for electrical calculations
export type Complex = { re: number; im: number };

export const C = (re = 0, im = 0): Complex => ({ re, im });

export const add = (a: Complex, b: Complex): Complex => C(a.re + b.re, a.im + b.im);
export const sub = (a: Complex, b: Complex): Complex => C(a.re - b.re, a.im - b.im);
export const mul = (a: Complex, b: Complex): Complex => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const div = (a: Complex, b: Complex): Complex => {
  const den = b.re * b.re + b.im * b.im || 1e-12;
  return C((a.re * b.re + a.im * b.im) / den, (a.im * b.re - a.re * b.im) / den);
};

export const conj = (a: Complex): Complex => C(a.re, -a.im);
export const scale = (a: Complex, k: number): Complex => C(a.re * k, a.im * k);
export const abs = (a: Complex): number => Math.hypot(a.re, a.im);
export const arg = (a: Complex): number => Math.atan2(a.im, a.re);
export const fromPolar = (mag: number, angleRad: number): Complex => C(mag * Math.cos(angleRad), mag * Math.sin(angleRad));

export const nearlyEqual = (a: Complex, b: Complex, eps = 1e-6): boolean => abs(sub(a, b)) < eps;
