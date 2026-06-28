/**
 * Display-boundary formatters. These run ONLY at render time — the domain layer keeps money as
 * exact pico-USD `BigInt` and tokens as integers; nothing here ever feeds back into a stored
 * value. (The frozen smoke reads the RAW `data-*` integers, never this rounded text.)
 */

const PICO_PER_CENT = 10_000_000_000n; // 1 cent = 1e-2 USD = 1e10 pico-USD

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Exact pico-USD -> "$1,234.56" (rounded to the nearest cent via integer math). */
export function formatUsdFromPico(pico: bigint): string {
  const negative = pico < 0n;
  const magnitude = negative ? -pico : pico;
  const cents = (magnitude + PICO_PER_CENT / 2n) / PICO_PER_CENT;
  const dollars = cents / 100n;
  const remainder = cents % 100n;
  const body = `${groupThousands(dollars.toString())}.${remainder.toString().padStart(2, '0')}`;
  return `${negative ? '-' : ''}$${body}`;
}

/** Token volume -> compact "12.3M" / "456.0K" / "789". */
export function formatTokensCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return groupThousands(String(n));
}

/** Signed basis points -> "+12.3%" / "-4.5%" / "0.0%". */
export function formatDeltaPercent(basisPoints: number): string {
  const pct = basisPoints / 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/** A short, timezone-free month-day label for ISO dates (no Date / Intl). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatMonthDay(iso: string): string {
  const [, m, d] = iso.split('-');
  const month = MONTHS[Number(m) - 1] ?? m ?? '';
  return `${month} ${Number(d)}`;
}
