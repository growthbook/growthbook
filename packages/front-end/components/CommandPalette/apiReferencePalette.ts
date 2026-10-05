import { docUrl } from "@/components/DocLink";
import type { ApiReferenceSection } from "@/components/docSections";

/**
 * Rows for Cmd+K: links into the REST API reference.
 *
 * The reference has one page per operation, grouped by resource in the
 * docs.json API navigation. Each resource row opens the first page of its
 * group, via an `api*` entry in `apiReferenceSections` so the docs link check
 * validates it. `getDocSectionsForCommandPalette` skips those entries, so each
 * resource is listed once. `tag` is the OpenAPI tag, kept for search and the
 * row id.
 */
export interface ApiReferencePaletteRow {
  id: string;
  title: string;
  url: string;
  tags: string;
}

const API_TAGS: { tag: string; title: string; section: ApiReferenceSection }[] =
  [
    { tag: "projects", title: "Projects", section: "apiProjects" },
    { tag: "environments", title: "Environments", section: "apiEnvironments" },
    { tag: "features", title: "Feature Flags", section: "apiFeatures" },
    { tag: "data-sources", title: "Data Sources", section: "apiDataSources" },
    { tag: "fact-tables", title: "Fact Tables", section: "apiFactTables" },
    { tag: "fact-metrics", title: "Fact Metrics", section: "apiFactMetrics" },
    { tag: "metrics", title: "Metrics (legacy)", section: "apiMetrics" },
    { tag: "experiments", title: "Experiments", section: "apiExperiments" },
    {
      tag: "snapshots",
      title: "Experiment Snapshots",
      section: "apiSnapshots",
    },
    { tag: "dimensions", title: "Dimensions", section: "apiDimensions" },
    { tag: "segments", title: "Segments", section: "apiSegments" },
    {
      tag: "sdk-connections",
      title: "SDK Connections",
      section: "apiSdkConnections",
    },
    {
      tag: "visual-changesets",
      title: "Visual Changesets",
      section: "apiVisualChangesets",
    },
    { tag: "saved-groups", title: "Saved Groups", section: "apiSavedGroups" },
    {
      tag: "organizations",
      title: "Organizations",
      section: "apiOrganizations",
    },
    { tag: "members", title: "Members", section: "apiMembers" },
    {
      tag: "code-references",
      title: "Code References",
      section: "apiCodeReferences",
    },
    { tag: "archetypes", title: "Archetypes", section: "apiArchetypes" },
    { tag: "queries", title: "Queries", section: "apiQueries" },
    { tag: "settings", title: "Settings", section: "apiSettings" },
    { tag: "attributes", title: "Attributes", section: "apiAttributes" },
    { tag: "usage", title: "Usage", section: "apiUsage" },
    { tag: "CustomFields", title: "Custom Fields", section: "apiCustomFields" },
    { tag: "Dashboards", title: "Dashboards", section: "apiDashboards" },
    {
      tag: "ExperimentTemplates",
      title: "Experiment Templates",
      section: "apiExperimentTemplates",
    },
    { tag: "MetricGroups", title: "Metric Groups", section: "apiMetricGroups" },
    { tag: "Teams", title: "Teams", section: "apiTeams" },
  ];

/** Searchable API reference entries for the command palette (opens docs in a new tab). */
export function getApiReferencePaletteRows(): ApiReferencePaletteRow[] {
  const overview: ApiReferencePaletteRow = {
    id: "api::overview",
    title: "REST API — Overview",
    url: docUrl("apiIntroduction"),
    tags: "api rest openapi reference documentation authentication",
  };

  const byTag = API_TAGS.map(({ tag, title, section }) => ({
    id: `api::tag::${tag}`,
    title,
    url: docUrl(section),
    tags: `api rest openapi endpoint ${tag} ${tag.toLowerCase()} ${title.replace(/[()]/g, "")}`,
  }));

  return [overview, ...byTag];
}
