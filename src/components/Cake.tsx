import { useMemo } from 'react';
import type { Layer, LayerId } from '../lib/types.ts';
import { useElementWidth } from '../lib/hooks.ts';
import { fmtPct } from '../lib/format.ts';

export interface CakeStat {
  companies: number;
  ret?: number; // basket return for the annotation
  retLabel: string;
  names: string[];
}

/**
 * The five-layer cake drawn as a slice of a cylinder: each layer is a band whose edges are the front
 * halves of ellipses, so the bands read as stacked tiers. Bottom = L1 Energy, top = L5 Applications.
 */
export function Cake({
  layers,
  stats,
  selected,
  onSelect,
}: {
  layers: Layer[];
  stats: Record<string, CakeStat>;
  selected: LayerId;
  onSelect: (id: LayerId) => void;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const compact = width > 0 && width < 560;
  const top = useMemo(() => layers.slice().sort((a, b) => b.order - a.order), [layers]); // L5 first

  const W = compact ? 420 : 660;
  const cx = compact ? 210 : 220;
  const rx = compact ? 196 : 200;
  const ry = compact ? 30 : 32;
  const H = compact ? 70 : 66;
  const y0 = ry + 10;
  const bottom = y0 + H * top.length;
  const Hsvg = bottom + ry + 24;

  const band = (i: number) => {
    const yt = y0 + i * H;
    const yb = yt + H;
    return `M ${cx - rx} ${yt} A ${rx} ${ry} 0 0 0 ${cx + rx} ${yt} L ${cx + rx} ${yb} A ${rx} ${ry} 0 0 1 ${cx - rx} ${yb} Z`;
  };
  const silhouette = `M ${cx - rx} ${y0} L ${cx - rx} ${bottom} A ${rx} ${ry} 0 0 0 ${cx + rx} ${bottom} L ${cx + rx} ${y0} A ${rx} ${ry} 0 0 0 ${cx - rx} ${y0} Z`;

  return (
    <div ref={ref} className="cake">
      <svg viewBox={`0 0 ${W} ${Hsvg}`} role="group" aria-label="The five-layer cake of the AI economy">
        <defs>
          <linearGradient id="cake-shade" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" className="cake-shade-edge" />
            <stop offset="0.2" className="cake-shade-clear" />
            <stop offset="0.42" className="cake-shade-light" />
            <stop offset="0.7" className="cake-shade-clear" />
            <stop offset="1" className="cake-shade-edge" />
          </linearGradient>
        </defs>
        {/* plate */}
        <ellipse cx={cx} cy={bottom + 8} rx={rx + 22} ry={ry + 7} className="cake-plate" />
        {top.map((l, i) => {
          const yt = y0 + i * H;
          const mid = yt + H / 2 + ry * 0.92;
          const st = stats[l.id];
          const isSel = l.id === selected;
          return (
            <g
              key={l.id}
              data-layer={l.id}
              className={`cake-band${isSel ? ' selected' : ''}`}
              role="button"
              tabIndex={0}
              aria-pressed={isSel}
              aria-label={`L${l.order} ${l.name}: ${l.tagline}`}
              onClick={() => onSelect(l.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(l.id);
                }
              }}
            >
              <path d={band(i)} className="cake-band-fill" />
              <path d={`M ${cx - rx} ${yt} A ${rx} ${ry} 0 0 0 ${cx + rx} ${yt}`} className="cake-band-edge" />
              <text x={cx} y={mid - 7} textAnchor="middle" className="cake-name">
                <tspan className="cake-code">L{l.order}</tspan>
                <tspan dx="8">{l.name}</tspan>
              </text>
              <text x={cx} y={mid + 13} textAnchor="middle" className="cake-tickers">
                {(st?.names ?? []).slice(0, compact ? 4 : 5).join('  ·  ')}
              </text>
              {!compact ? (
                <g className="cake-note">
                  <line x1={cx + rx + 6} x2={cx + rx + 30} y1={yt + H / 2} y2={yt + H / 2} />
                  <text x={cx + rx + 38} y={yt + H / 2 - 4} className="cake-note-title">
                    {l.tagline.length > 46 ? `${l.tagline.slice(0, 44)}…` : l.tagline}
                  </text>
                  <text x={cx + rx + 38} y={yt + H / 2 + 13} className="cake-note-sub">
                    {st ? `${st.companies} companies` : ''}
                    {st?.ret !== undefined ? ` · ${st.retLabel} ` : ''}
                    {st?.ret !== undefined ? (
                      <tspan className={st.ret >= 0 ? 'cake-up' : 'cake-down'}>{fmtPct(st.ret)}</tspan>
                    ) : null}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
        {/* top face of the cake */}
        <ellipse cx={cx} cy={y0} rx={rx} ry={ry} className="cake-top" data-layer={top[0]?.id} />
        <path d={silhouette} fill="url(#cake-shade)" className="cake-gloss" />
      </svg>
    </div>
  );
}
