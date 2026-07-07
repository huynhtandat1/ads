// Mask the real DB id into an opaque 6-char code. Multiplicative hash với
// K và M nguyên tố cùng nhau (gcd(K, M) = 1) → bijection trên [0, M-1].
// Hai trường hợp KHÔNG bijection (chấp nhận):
//   1. n < 0  : PostgreSQL `integer` cho phép id âm; JS `%` giữ dấu số bị chia
//               → dùng ((n % M) + M) % M để đảm bảo dương.
//   2. |n| ≥ M (~2.18 tỷ) : hash sẽ trùng với một số trong [0, M-1]. PG `integer`
//               max = 2.147 tỷ < M, nên production không đụng; ETL bigint cần đổi.
const K = 2654435761;
const M = 2176782336; // 36^6

export function formatId(id: number | string): string {
  const n = Number(id);
  if (!Number.isFinite(n)) return String(id);
  const safe = ((n % M) + M) % M;  // đưa về [0, M-1] an toàn cho số âm
  const hashed = (safe * K) % M;
  return hashed.toString(36).toUpperCase().padStart(6, '0');
}

// Định dạng tiền tệ: tối đa 2 chữ số thập phân (tránh hiển thị .151 do dữ liệu lẻ).
export function money(v: number): string {
  return '¥' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Làm tròn dùng trong TÍNH TOÁN: giữ 3 chữ số thập phân. Hiển thị vẫn 2 chữ số (money()).
export const round3 = (v: number) => Math.round(v * 1000) / 1000;
