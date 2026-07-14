export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function safeHexColor(value: unknown, fallback = '#000000'): string {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback;
}
