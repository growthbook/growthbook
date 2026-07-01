import { ApiContextualBanditInterface } from "shared/validators";
import { ExperimentDataForStatusStringDates } from "shared/types/experiment";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";

/**
 * Adapts a CB into the experiment-shaped data `ExperimentStatusIndicator` expects,
 * so contextual bandits render the exact same status badge as experiments. CBs lack
 * several experiment fields, so supply harmless defaults for the indicator.
 */
export function contextualBanditStatusIndicatorData(
  cb: ApiContextualBanditInterface,
): ExperimentDataForStatusStringDates {
  return {
    type: "contextual-bandit",
    variations: cb.variations,
    status: cb.status,
    archived: cb.archived,
    results: undefined,
    analysisSummary: undefined,
    phases: [
      {
        dateStarted: cb.dateStarted ?? cb.dateCreated,
        dateEnded: cb.dateStopped ?? undefined,
        name: "Main",
        reason: "",
        coverage: cb.coverage ?? 1,
        condition: cb.condition ?? "",
        variationWeights: cb.variations.map(
          (v) =>
            cb.variationWeights?.find((w) => w.variationId === v.id)?.weight ??
            1,
        ),
        variations: cb.variations.map((v) => ({ id: v.id })),
        seed: cb.seed,
      },
    ],
    dismissedWarnings: [],
    goalMetrics: cb.decisionMetric ? [cb.decisionMetric] : [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    datasource: cb.datasource,
    decisionFrameworkSettings: {},
    nextScheduledStatusUpdate: null,
  } as unknown as ExperimentDataForStatusStringDates;
}

/** Computed-fields shape the CB list page consumes, typed off `ApiContextualBanditInterface`. */
export type ComputedContextualBanditInterface = ApiContextualBanditInterface & {
  ownerName: string;
  metricNames: string[];
  projectId?: string;
  projectName?: string;
  projectIsDeReferenced?: string | boolean;
  tab: string;
  date: string;
  isWatched?: boolean;
};

function cbDate(cb: ApiContextualBanditInterface): string {
  if (cb.archived) return cb.dateUpdated;
  if (cb.status === "running") {
    return cb.dateStarted ?? cb.dateCreated;
  }
  if (cb.status === "stopped") {
    return cb.dateStopped ?? cb.dateUpdated;
  }
  return cb.dateCreated;
}

/** CB-native equivalent of `useExperimentSearch` — search/sort/filter primitives for the CB list. */
export function useContextualBanditSearch({
  contextualBandits,
  defaultSortField = "date",
  defaultSortDir = -1,
  filterResults,
  localStorageKey,
  watchedIds,
}: {
  contextualBandits: ApiContextualBanditInterface[];
  defaultSortField?: keyof ComputedContextualBanditInterface;
  defaultSortDir?: -1 | 1;
  filterResults?: (
    items: ComputedContextualBanditInterface[],
  ) => ComputedContextualBanditInterface[];
  localStorageKey: string;
  watchedIds?: string[];
}) {
  const { getProjectById, getExperimentMetricById } = useDefinitions();
  const { getOwnerDisplay } = useUser();

  const items: ComputedContextualBanditInterface[] = useAddComputedFields(
    contextualBandits,
    (cb) => {
      const projectId = cb.project;
      const projectName = projectId
        ? getProjectById(projectId)?.name
        : undefined;
      const projectIsDeReferenced = !!projectId && !projectName;
      const metricIds = [cb.decisionMetric ?? ""].filter(Boolean);
      const metricNames = Array.from(
        new Set(
          metricIds
            .map((id) => getExperimentMetricById(id)?.name)
            .filter((name): name is string => !!name),
        ),
      );
      return {
        ownerName: getOwnerDisplay(cb.owner),
        metricNames,
        projectId,
        projectName,
        projectIsDeReferenced,
        tab: cb.archived
          ? "archived"
          : cb.status === "draft"
            ? "drafts"
            : cb.status,
        date: cbDate(cb),
        isWatched: watchedIds?.includes(cb.id) ?? false,
      };
    },
    [getProjectById, getOwnerDisplay, getExperimentMetricById],
  );

  return useSearch({
    items,
    localStorageKey,
    defaultSortField,
    defaultSortDir,
    updateSearchQueryOnChange: true,
    searchFields: ["name^3", "trackingKey^2", "description"],
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [];
        if (item.archived) is.push("archived");
        if (item.status === "draft") is.push("draft");
        if (item.status === "running") is.push("running");
        if (item.status === "stopped") is.push("stopped");
        if (item.isWatched) is.push("watched");
        return is;
      },
      has: (item) => {
        const has: string[] = [];
        if (item.project) has.push("project");
        if (item.description?.trim()?.length) has.push("description");
        return has;
      },
      variations: (item) => item.variations.length,
      variation: (item) => item.variations.map((v) => v.name),
      created: (item) => new Date(item.dateCreated),
      updated: (item) => new Date(item.dateUpdated),
      name: (item) => item.name,
      key: (item) => item.trackingKey,
      trackingKey: (item) => item.trackingKey,
      id: (item) => [item.id, item.trackingKey],
      status: (item) => item.status,
      owner: (item) => [item.owner, item.ownerName],
      tag: (item) => item.tags,
      metric: (item) =>
        [...item.metricNames, item.decisionMetric ?? ""].filter(Boolean),
      project: (item) => [item.projectId ?? "", item.projectName ?? ""],
      datasource: (item) => item.datasource,
    },
    filterResults,
  });
}
