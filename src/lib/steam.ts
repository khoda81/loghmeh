// Saffron Orbit's steam wave, sampled for native SVG animation instead of a
// requestAnimationFrame loop for every small loading indicator.
const period = 2 * Math.PI / 1.5;
export function steamPath(time: number, strand: number) {
  return Array.from({ length: 19 }, (_, point) => {
    const q = point / 18;
    const x = 32 + (strand - 1) * 18 + Math.sin(q * 5.4 - time * 1.5 + strand * 2.1) * (2 + 7 * q);
    return `${point ? 'L' : 'M'}${x.toFixed(2)},${(80 - q * 80).toFixed(2)}`;
  }).join(' ');
}
export const STEAM_DURATION = `${period}s`;
export const STEAM_STRANDS = Array.from({ length: 3 }, (_, strand) => ({
  still: steamPath(0, strand),
  frames: Array.from({ length: 25 }, (_, frame) => steamPath(frame / 24 * period, strand)).join(';'),
}));
