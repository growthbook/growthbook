import { ApiContextualBanditInterface } from "shared/validators";
import { contextualBanditEndpoints } from "shared/api-endpoints";
import { getActiveVariations } from "shared/experiments";
import { useMemo } from "react";
import { z } from "zod";
import {
  getContextualBanditResultStatus,
  getHealthSettings,
} from "shared/enterprise";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import type { IssueValue } from "@/components/HealthTab/IssueTags";
import { useContextualBanditSnapshot } from "@/components/ContextualBandit/ContextualBanditSnapshotProvider";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useRestApi } from "@/services/restApi";

/** Fetches CB docs from the REST API and returns the API shape directly. */
export function useContextualBandits(
  project?: string,
  includeArchived: boolean = false,
) {
  const { data, error, mutate } = useRestApi(
    contextualBanditEndpoints.listContextualBandits,
    {
      query: { projectId: project || undefined },
    },
  );

  const allContextualBandits = useMemo(
    () => data?.contextualBandits ?? [],
    [data],
  );

  const contextualBandits = useMemo(
    () =>
      includeArchived
        ? allContextualBandits
        : allContextualBandits.filter((cb) => !cb.archived),
    [allContextualBandits, includeArchived],
  );

  const contextualBanditsMap = useMemo(
    () => new Map(allContextualBandits.map((cb) => [cb.id, cb])),
    [allContextualBandits],
  );

  return {
    loading: !error && !data,
    contextualBandits,
    contextualBanditsMap,
    error,
    mutate,
    hasArchived: allContextualBandits.some((cb) => cb.archived),
  };
}

/** Single-CB fetch returning the CB-native API shape. */
export function useContextualBandit(cbId: string | undefined) {
  const { data, error, mutate } = useRestApi(
    contextualBanditEndpoints.getContextualBandit,
    cbId ? { params: { id: cbId } } : null,
  );

  return {
    loading: !!cbId && !error && !data,
    contextualBandit: data?.contextualBandit,
    error,
    mutate,
  };
}

/** Fetches the features linked to a CB (enriched `LinkedFeatureInfo[]`) for the Linked Features section. */
export function useContextualBanditLinkedFeatures(cbId: string | undefined) {
  const { data, error, mutate } = useRestApi(
    contextualBanditEndpoints.getContextualBanditLinkedFeatures,
    cbId ? { params: { id: cbId } } : null,
  );

  return {
    loading: !!cbId && !error && !data,
    linkedFeatures: data?.linkedFeatures ?? [],
    environments: data?.environments ?? [],
    error,
    mutate,
  };
}

export function useContextualBanditVisualChangesets(cbId: string | undefined) {
  const { data, error, mutate } = useRestApi(
    contextualBanditEndpoints.listContextualBanditVisualChangesets,
    cbId ? { params: { id: cbId } } : null,
  );

  const visualChangesets = useMemo<VisualChangesetInterface[]>(
    () =>
      (data?.visualChangesets ?? []).map((vc) => ({
        id: vc.id ?? "",
        organization: "",
        editorUrl: vc.editorUrl,
        experiment: vc.experiment,
        contextualBandit: vc.contextualBandit,
        urlPatterns: vc.urlPatterns.map((p) => ({
          pattern: p.pattern,
          type: p.type,
          include: p.include ?? true,
        })),
        visualChanges: vc.visualChanges.map((c) => ({
          id: c.id ?? "",
          description: c.description ?? "",
          css: c.css ?? "",
          js: c.js,
          variation: c.variation,
          domMutations: c.domMutations,
        })),
      })),
    [data],
  );

  return {
    loading: !!cbId && !error && !data,
    visualChangesets,
    error,
    mutate,
  };
}

/** Health inputs driving the CB status badge and Health tab. */
export type ContextualBanditStatusHealth = {
  srm: number | null;
  totalUsers: number;
  multipleExposures: number;
  /** Variations frozen by the run that produced these numbers. */
  variationIds: string[];
};

export type ContextualBanditResultsHealthView = NonNullable<
  z.infer<
    typeof contextualBanditEndpoints.getContextualBanditResults.responseSchema
  >["results"]
>["health"];

/**
 * `health` is the payload from the loaded results; `persisted` is the summary
 * on the CB doc, used only until results have loaded.
 */
export function resolveContextualBanditStatusHealth(
  health: ContextualBanditResultsHealthView | undefined,
  persisted: ApiContextualBanditInterface["analysisSummary"],
  cbVariations: ApiContextualBanditInterface["variations"],
): ContextualBanditStatusHealth | undefined {
  if (health !== undefined) {
    const totalUsers =
      health?.traffic?.overall?.variationUnits?.reduce(
        (sum, n) => sum + n,
        0,
      ) ?? 0;
    // With no traffic there is nothing to assess. Return undefined so callers
    // treat this as "no health data" rather than an assessed, healthy result.
    if (!health || totalUsers === 0) {
      return undefined;
    }
    return {
      srm: health.srm?.pValue ?? null,
      totalUsers,
      multipleExposures: health.multipleExposures ?? 0,
      variationIds: health.variations.map((v) => v.variationId),
    };
  }
  const summary = persisted?.health;
  if (summary && summary.totalUsers > 0) {
    return {
      srm: summary.srm ?? null,
      totalUsers: summary.totalUsers,
      multipleExposures: summary.multipleExposures ?? 0,
      // Summaries written before variationIds was recorded fall back to the
      // arms currently active, the same set a fresh run would freeze.
      variationIds:
        summary.variationIds ??
        getActiveVariations(cbVariations).map((v) => v.id),
    };
  }
  return undefined;
}

/**
 * Resolves the health inputs for a CB's status badge and Health tab.
 */
export function useContextualBanditStatusHealth(
  cb: ApiContextualBanditInterface,
): ContextualBanditStatusHealth | undefined {
  const { results, loading } = useContextualBanditSnapshot();
  return useMemo(
    () =>
      resolveContextualBanditStatusHealth(
        loading ? undefined : (results?.health ?? null),
        cb.analysisSummary,
        cb.variations,
      ),
    [cb.analysisSummary, cb.variations, results, loading],
  );
}

/**
 * Computes the CB health issues (Balance) for the current results snapshot.
 */
export function useContextualBanditHealthIssues(
  cb: ApiContextualBanditInterface,
): IssueValue[] {
  const orgSettings = useOrgSettings();
  const health = useContextualBanditStatusHealth(cb);

  return useMemo<IssueValue[]>(() => {
    if (!health) return [];
    const healthSettings = getHealthSettings(orgSettings);
    const resultStatus = getContextualBanditResultStatus({
      srm: health.srm,
      totalUsers: health.totalUsers,
      multipleExposures: health.multipleExposures,
      numOfVariations: health.variationIds.length,
      healthSettings,
    });
    if (resultStatus?.status !== "unhealthy") return [];
    const issues: IssueValue[] = [];
    if (resultStatus.unhealthyData.srm) {
      issues.push({ label: "Balance", value: "balanceCheck" });
    }
    if (resultStatus.unhealthyData.multipleExposures) {
      issues.push({
        label: "Multiple Exposures",
        value: "multipleExposures",
      });
    }
    return issues;
  }, [health, orgSettings]);
}
