// Taxonomy index: fast lookups from node paths to layers, industries, segments and member companies.
import type { AnyRecord, Company, Industry, Layer, LayerId, NewsItem, ReportMeta, Segment, SiteData, ThesisRecord } from './types.ts';

export interface NodeInfo {
  path: string;
  kind: 'layer' | 'industry' | 'segment';
  name: string;
  nameZh?: string;
  layer: Layer;
  industry?: Industry;
  segment?: Segment;
}

export interface TaxonomyIndex {
  nodes: Map<string, NodeInfo>;
  layerById: Map<LayerId, Layer>;
  companiesUnder: (path: string) => string[]; // unique company ids at or below a node
}

export function buildIndex(site: SiteData): TaxonomyIndex {
  const nodes = new Map<string, NodeInfo>();
  const layerById = new Map<LayerId, Layer>();
  const under = new Map<string, Set<string>>();
  const add = (path: string, id: string) => {
    if (!under.has(path)) under.set(path, new Set());
    under.get(path)!.add(id);
  };
  for (const layer of site.layers) {
    layerById.set(layer.id, layer);
    nodes.set(layer.id, { path: layer.id, kind: 'layer', name: layer.name, nameZh: layer.nameZh, layer });
    for (const ind of layer.industries) {
      nodes.set(ind.path, { path: ind.path, kind: 'industry', name: ind.name, nameZh: ind.nameZh, layer, industry: ind });
      for (const seg of ind.segments) {
        nodes.set(seg.path, { path: seg.path, kind: 'segment', name: seg.name, nameZh: seg.nameZh, layer, industry: ind, segment: seg });
        for (const c of seg.companies) {
          add(seg.path, c);
          add(ind.path, c);
          add(layer.id, c);
        }
      }
    }
  }
  return {
    nodes,
    layerById,
    companiesUnder: (path: string) => [...(under.get(path) ?? [])],
  };
}

export function layerOfPath(path: string): LayerId {
  return path.split('/')[0] as LayerId;
}

/** Whether a node path is at or below `ancestor`. */
export function isUnder(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

export function industryLink(path: string): string {
  const [layer, industry, segment] = path.split('/');
  if (!industry) return `/layer/${layer}`;
  return `/industry/${layer}/${industry}${segment ? `#${segment}` : ''}`;
}

export function companyIdsOfRecord(r: AnyRecord): string[] {
  if (r.type === 'thesis') {
    const t = r as ThesisRecord;
    const ids = t.subject?.company ? [t.subject.company] : [];
    for (const rel of t.related ?? []) ids.push(rel.company);
    return ids;
  }
  if (r.type === 'note') return (r.subjects ?? []).map((s) => s.company).filter(Boolean) as string[];
  return [];
}

export function nodePathsOfRecord(r: AnyRecord): string[] {
  if (r.type === 'thesis') return r.subject?.node ? [r.subject.node] : [];
  if (r.type === 'note') return (r.subjects ?? []).map((s) => s.node).filter(Boolean) as string[];
  return [];
}

/** Content that belongs to a node: tagged with the node (or below), or about a company in it. */
export function relatesToNode<T extends { companies?: string[]; nodes?: string[] }>(
  item: T,
  path: string,
  members: Set<string>,
): 'direct' | 'company' | null {
  if (item.nodes?.some((n) => isUnder(n, path) || isUnder(path, n) && n.split('/').length > 1 && path.startsWith(n))) return 'direct';
  if (item.companies?.some((c) => members.has(c))) return 'company';
  return null;
}

export function recordsForCompany(records: AnyRecord[], companyId: string): AnyRecord[] {
  return records.filter((r) => companyIdsOfRecord(r).includes(companyId));
}

export function recordsForNode(records: AnyRecord[], path: string, members: Set<string>, rollUp = true): AnyRecord[] {
  return records.filter((r) => {
    if (nodePathsOfRecord(r).some((n) => (rollUp ? isUnder(n, path) : n === path))) return true;
    if (!rollUp) return false;
    return companyIdsOfRecord(r).some((c) => members.has(c));
  });
}

export function reportsForCompany(reports: ReportMeta[], companyId: string): ReportMeta[] {
  return reports.filter((r) => r.companies?.includes(companyId));
}

export function newsForCompany(news: NewsItem[], companyId: string): NewsItem[] {
  return news.filter((n) => n.companies?.includes(companyId));
}

export function companiesOfLayer(site: SiteData, layer: LayerId): Company[] {
  return Object.values(site.companies).filter((c) => c.layers.includes(layer));
}
