/**
 * Rows for Cmd+K: deep links into the Redoc REST API reference at docs.growthbook.io/api.
 * Each `tag` must match a top-level `id="tag/…"` on that page (Redoc fragment: #tag/{tag}).
 * Most tags are kebab-case from OpenAPI; a few published tags use PascalCase (see below).
 *
 * Re-verify after docs deploys: `curl -sL https://docs.growthbook.io/api | grep -oE 'id="tag/[^"]+"'`
 */
const API_REFERENCE_BASE = "https://docs.growthbook.io/api";

export interface ApiReferencePaletteRow {
  id: string;
  title: string;
  url: string;
  tags: string;
}

const API_TAGS: { tag: string; title: string }[] = [
  { tag: "projects", title: "Projects" },
  { tag: "environments", title: "Environments" },
  { tag: "features", title: "Feature Flags" },
  { tag: "data-sources", title: "Data Sources" },
  { tag: "fact-tables", title: "Fact Tables" },
  { tag: "fact-metrics", title: "Fact Metrics" },
  { tag: "metrics", title: "Metrics (legacy)" },
  { tag: "experiments", title: "Experiments" },
  { tag: "snapshots", title: "Experiment Snapshots" },
  { tag: "dimensions", title: "Dimensions" },
  { tag: "segments", title: "Segments" },
  { tag: "sdk-connections", title: "SDK Connections" },
  { tag: "visual-changesets", title: "Visual Changesets" },
  { tag: "saved-groups", title: "Saved Groups" },
  { tag: "organizations", title: "Organizations" },
  { tag: "members", title: "Members" },
  { tag: "code-references", title: "Code References" },
  { tag: "archetypes", title: "Archetypes" },
  { tag: "queries", title: "Queries" },
  { tag: "settings", title: "Settings" },
  { tag: "attributes", title: "Attributes" },
  { tag: "usage", title: "Usage" },
  { tag: "CustomFields", title: "Custom Fields" },
  { tag: "Dashboards", title: "Dashboards" },
  { tag: "ExperimentTemplates", title: "Experiment Templates" },
  { tag: "MetricGroups", title: "Metric Groups" },
  { tag: "Teams", title: "Teams" },
];

/** Searchable API reference entries for the command palette (opens docs in a new tab). */
export function getApiReferencePaletteRows(): ApiReferencePaletteRow[] {
  const overview: ApiReferencePaletteRow = {
    id: "api::overview",
    title: "REST API — Overview",
    url: API_REFERENCE_BASE,
    tags: "api rest openapi reference documentation authentication",
  };

  const byTag = API_TAGS.map(({ tag, title }) => ({
    id: `api::tag::${tag}`,
    title,
    url: `${API_REFERENCE_BASE}#tag/${encodeURIComponent(tag)}`,
    tags: `api rest openapi endpoint ${tag} ${tag.toLowerCase()} ${title.replace(/[()]/g, "")}`,
  }));

  return [overview, ...byTag];
}
