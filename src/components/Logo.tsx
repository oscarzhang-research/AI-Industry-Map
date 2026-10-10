/** The mark: five strata stacked like a cake slice, bottom (energy) to top (applications). */
export function LogoMark({ size = 28 }: { size?: number }) {
  const bands = [
    { y: 23, w: 24, fill: 'var(--l1-line)' },
    { y: 18, w: 21, fill: 'var(--l2-line)' },
    { y: 13, w: 18, fill: 'var(--l3-line)' },
    { y: 8, w: 15, fill: 'var(--l4-line)' },
    { y: 3, w: 12, fill: 'var(--l5-line)' },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      {bands.map((b) => (
        <rect key={b.y} x={(28 - b.w) / 2} y={b.y} width={b.w} height={3.6} rx={1.8} fill={b.fill} />
      ))}
    </svg>
  );
}

/** Same mark as a static SVG string for the favicon (no CSS variables available there). */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="#141a22"/><rect x="2" y="21" width="24" height="3.6" rx="1.8" fill="#eda100"/><rect x="3.5" y="16.4" width="21" height="3.6" rx="1.8" fill="#1baf7a"/><rect x="5" y="11.8" width="18" height="3.6" rx="1.8" fill="#2a78d6"/><rect x="6.5" y="7.2" width="15" height="3.6" rx="1.8" fill="#e34948"/><rect x="8" y="2.6" width="12" height="3.6" rx="1.8" fill="#6250d6"/></svg>`;
