import { forwardRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Company, Direction, Layer, Quote } from '../lib/types.ts';
import { useStore } from '../lib/store.tsx';
import { CompanyChip } from './ui.tsx';
import { industryLink } from '../lib/nodes.ts';
import { POSITION_LABEL } from '../lib/format.ts';
import { heatColor } from './heat.ts';

export type MapColor = 'none' | 'd1' | 'ytd' | 'view';

/** The full landscape: every layer, industry, value-chain segment and company on one sheet. */
export const MarketMap = forwardRef<HTMLDivElement, { colorBy: MapColor; views: Map<string, Direction>; tiers: 'all' | 'core-focus' }>(
  function MarketMap({ colorBy, views, tiers }, ref) {
    const { site, quotes } = useStore();
    const layers = useMemo(() => site.layers.slice().sort((a, b) => b.order - a.order), [site.layers]);
    return (
      <div className="map-sheet" ref={ref}>
        {layers.map((l) => (
          <MapRow key={l.id} layer={l} companies={site.companies} quotes={quotes.quotes} colorBy={colorBy} views={views} tiers={tiers} />
        ))}
      </div>
    );
  },
);

function MapRow({
  layer,
  companies,
  quotes,
  colorBy,
  views,
  tiers,
}: {
  layer: Layer;
  companies: Record<string, Company>;
  quotes: Record<string, Quote>;
  colorBy: MapColor;
  views: Map<string, Direction>;
  tiers: 'all' | 'core-focus';
}) {
  const count = new Set(layer.industries.flatMap((i) => i.segments.flatMap((s) => s.companies))).size;
  return (
    <div className="map-row" data-layer={layer.id}>
      <div className="map-rail">
        <span className="code">L{layer.order}</span>
        <Link to={`/layer/${layer.id}`}>{layer.name}</Link>
        {layer.nameZh ? <span className="zh">{layer.nameZh}</span> : null}
        <span className="count">{count} companies</span>
      </div>
      <div className="map-industries">
        {layer.industries.map((ind) => (
          <div className="map-ind" key={ind.id}>
            <h3>
              <Link to={industryLink(ind.path)}>{ind.name}</Link>
            </h3>
            {ind.segments.map((seg) => {
              if (seg.ref) return null;
              const list = seg.companies
                .map((id) => companies[id])
                .filter((c): c is Company => !!c && (tiers === 'all' || c.tier !== 'watch'));
              if (!list.length) return null;
              return (
                <div className="map-seg" key={seg.id}>
                  <div className="seg-name">
                    <span className={`pos ${seg.position}`} title={POSITION_LABEL[seg.position]}>
                      {seg.position === 'upstream' ? 'UP' : seg.position === 'downstream' ? 'DOWN' : 'MID'}
                    </span>
                    <span>{seg.name}</span>
                  </div>
                  <div className="chips">
                    {list.map((c) => {
                      const q = c.symbol ? quotes[c.symbol] : undefined;
                      const val = colorBy === 'd1' ? q?.r.d1 : colorBy === 'ytd' ? q?.r.ytd : undefined;
                      const tint = val !== undefined ? heatColor(val, colorBy === 'd1' ? 'd1' : 'ytd') : undefined;
                      return (
                        <span key={c.id} style={tint ? ({ display: 'inline-flex', borderRadius: 6, background: tint.bg } as React.CSSProperties) : undefined}>
                          <CompanyChip
                            company={c}
                            quote={q}
                            show={colorBy === 'd1' ? 'd1' : colorBy === 'ytd' ? 'ytd' : 'none'}
                            view={colorBy === 'view' ? views.get(c.id) : undefined}
                            withName={c.listing !== 'listed' || !!c.symbol?.includes('.')}
                          />
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
