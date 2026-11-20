/** Small SVG of a set of wall cells, used on the splash and result card. */
export function silhouetteSVG(
  cells: string[],
  opts: { fill?: string; stroke?: string; size?: number; unit?: number } = {},
): string {
  const pts = cells.map((k) => {
    const [x = '0', y = '0'] = k.split(',');
    return [Number(x), Number(y)] as const;
  });
  if (!pts.length) return '';
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs) - 0.5;
  const maxX = Math.max(...xs) + 0.5;
  const minY = Math.min(...ys) - 0.5;
  const maxY = Math.max(...ys) + 0.5;
  const w = maxX - minX;
  const h = maxY - minY;
  const pad = 0.35;
  const rects = pts
    .map(([x, y]) => `<rect x="${x - 0.5 - minX}" y="${maxY - (y + 0.5)}" width="1.02" height="1.02" />`)
    .join('');
  const fill = opts.fill ?? 'currentColor';
  // Fit inside `size`, but never draw a block bigger than `unit` px,
  // so small shapes stay small instead of being blown up.
  const vw = w + pad * 2;
  const vh = h + pad * 2;
  const max = opts.size ?? 120;
  const scale = Math.min(max / vw, (max * 0.75) / vh, opts.unit ?? 18);
  return `<svg viewBox="${-pad} ${-pad} ${vw} ${vh}" width="${Math.round(vw * scale)}" height="${Math.round(vh * scale)}" aria-hidden="true"><g fill="${fill}"${opts.stroke ? ` stroke="${opts.stroke}" stroke-width="0.06"` : ''}>${rects}</g></svg>`;
}
