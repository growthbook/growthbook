import { ApiContextualBanditInterface } from "shared/validators";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";

/**
 * Computed-fields shape that the CB list page consumes — same idea as
 * `ComputedExperimentInterface` for the experiment list, but typed
 * directly off `ApiContextualBanditInterface` so the page doesn't have
 * to round-trip through an experiment projection.
 *
 * The fields here are the union of what the list-page renderer reads
 * (ownerName, projectName, tab, date, isWatched) plus a few useful
 * search filters. Sort fields all live on the base CB API shape, so
 * sort by `name`/`tags`/`status` works without any extra computed work.
 */
export type ComputedContextualBanditInterface = ApiContextualBanditInterface & {
  ownerName: string;
  projectId?: string;
  projectName?: string;
  projectIsDeReferenced?: string | boolean;
  /** Bucket the CB falls into in the list-page tabs (`drafts` / `running` / `stopped` / `archived`). */
  tab: string;
  /** ISO date used for the "Date" column — phase start / phase end / created depending on status. */
  date: string;
  isWatched?: boolean;
};

function cbDate(cb: ApiContextualBanditInterface): string {
  if (cb.archived) return cb.dateUpdated;
  if (cb.status === "running") {
    return cb.phases?.[cb.phases.length - 1]?.dateStarted ?? cb.dateCreated;
  }
  if (cb.status === "stopped") {
    const ended = cb.phases?.[cb.phases.length - 1]?.dateEnded;
    return ended ?? cb.dateUpdated;
  }
  return cb.dateCreated;
}

/**
 * CB-native equivalent of `useExperimentSearch`. Takes a flat array of
 * `ApiContextualBanditInterface[]` and returns the search/sort/filter
 * primitives the list page wires into its table.
 *
 * Deliberately a smaller surface than the experiment hook — CB doesn't
 * have visualChangesets, hypothesis-as-tag, results=won/lost/etc., or
 * the variation-level search filters that experiments do. Add those as
 * CBs grow features they need.
 */
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
  const { getProjectById } = useDefinitions();
  const { getOwnerDisplay } = useUser();

  const items: ComputedContextualBanditInterface[] = useAddComputedFields(
    contextualBandits,
    (cb) => {
      const projectId = cb.project;
      const projectName = projectId
        ? getProjectById(projectId)?.name
        : undefined;
      const projectIsDeReferenced = !!projectId && !projectName;
      return {
        ownerName: getOwnerDisplay(cb.owner),
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
    [getProjectById, getOwnerDisplay],
  );

  return useSearch({
    items,
    localStorageKey,
    defaultSortField,
    defaultSortDir,
    updateSearchQueryOnChange: true,
    searchFields: ["name^3", "trackingKey^2", "hypothesis^2", "description"],
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
        if (item.hypothesis?.trim()?.length) has.push("hypothesis");
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
      project: (item) => [item.projectId ?? "", item.projectName ?? ""],
      datasource: (item) => item.datasource,
    },
    filterResults,
  });
}
