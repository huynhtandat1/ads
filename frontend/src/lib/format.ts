// Mask the real (small, sequential) DB id into an opaque, fixed-length code so the
// raw id is hidden. Uses a multiplicative hash that is a bijection over 36^6
// (gcd(K, 36^6) = 1), so distinct ids always map to distinct 6-char codes.
const K = 2654435761;
const M = 2176782336; // 36^6

export function formatId(id: number | string): string {
  const n = Number(id);
  if (!Number.isFinite(n)) return String(id);
  const hashed = (n * K) % M;
  return hashed.toString(36).toUpperCase().padStart(6, '0');
}
