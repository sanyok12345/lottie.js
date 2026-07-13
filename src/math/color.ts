export function rgb(c: number[] = []): string {
  const [r, g, b] = to255(c);
  return `rgb(${r},${g},${b})`;
}

export function to255(c: number[] = []): [number, number, number] {
  const parts = [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
  const scale = parts.some((v) => v > 1) ? 1 : 255;
  const [r, g, b] = parts.map((v) => Math.round(Math.min(255, Math.max(0, v * scale))));
  return [r, g, b];
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length < 6) h = h.split('').map((ch) => ch + ch).join('');
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}
