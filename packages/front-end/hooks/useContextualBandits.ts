import {
  ApiContextualBanditInterface,
  ContextualBanditSrmLatestPeriod,
} from "shared/validators";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ExperimentSnapshotTraffic,
  SnapshotStatusSummary,
} from "shared/types/experiment-snapshot";
import type { ContextualBanditSnapshot } from "shared/types/stats";
import type { ContextualBanditResultsView } from "shared/experiments";
import type { LinkedFeatureInfo } from "shared/types/experiment";
import {
  getContextualBanditResultStatus,
  getHealthSettings,
} from "shared/enterprise";
import type { IssueValue } from "@/components/HealthTab/IssueTags";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import useApi from "./useApi";

/** Fetches CB docs from the REST API and returns the API shape directly. */
export function useContextualBandits(
  project?: string,
  includeArchived: boolean = false,
) {
  const path = `/api/v1/contextual-bandits${project ? `?projectId=${encodeURIComponent(project)}` : ""}`;
  const { data, error, mutate } = useApi<{
    contextualBandits: ApiContextualBanditInterface[];
  }>(path);

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
  const { data, error, mutate } = useApi<{
    contextualBandit: ApiContextualBanditInterface;
  }>(
    cbId
      ? `/api/v1/contextual-bandits/${cbId}`
      : "/api/v1/contextual-bandits/__missing__",
    {
      shouldRun: () => !!cbId,
    },
  );

  return {
    loading: !!cbId && !error && !data,
    contextualBandit: data?.contextualBandit,
    error,
    mutate,
  };
}

export type ContextualBanditResultsLatest = SnapshotStatusSummary & {
  srm?: {
    statistic: number;
    pValue: number;
    degreesOfFreedom: number;
    latestPeriod?: ContextualBanditSrmLatestPeriod;
  } | null;
  traffic?: ExperimentSnapshotTraffic | null;
};

export type ContextualBanditResultsResponse = {
  status: number;
  contextualBanditSnapshot: ContextualBanditSnapshot | null;
  overallWeights: { variationId: string; weight: number | null }[] | null;
  results: ContextualBanditResultsView | null;
  latest: ContextualBanditResultsLatest | null;
};

/**
 * CB-native results state: fetches the CB results snapshot, auto-polls while a run is in progress,
 * and exposes a refresh action. Replaces the experiment `useSnapshot()` context for CBs.
 */
export function useContextualBanditResults(cbId: string | undefined) {
  const { apiCall } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  const { data, error, mutate } = useApi<ContextualBanditResultsResponse>(
    cbId
      ? `/api/v1/contextual-bandits/${cbId}/results`
      : "/api/v1/contextual-bandits/__missing__/results",
    { shouldRun: () => !!cbId },
  );

  const latest = data?.latest ?? null;
  const isRunning = latest?.status === "running";

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      void mutate();
    }, 2000);
    return () => clearInterval(timer);
  }, [isRunning, mutate]);

  const refresh = useCallback(async () => {
    if (!cbId) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      await apiCall<{ snapshotId: string; cbeId?: string }>(
        `/api/v1/contextual-bandits/${cbId}/refresh`,
        { method: "POST" },
      );
      await mutate();
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [apiCall, cbId, mutate]);

  return {
    loading: !!cbId && !error && !data,
    contextualBanditSnapshot: data?.contextualBanditSnapshot ?? null,
    results: data?.results ?? null,
    latest,
    error,
    mutate,
    refresh,
    refreshing,
    refreshError,
    setRefreshError,
  };
}

export type ContextualBanditLinkedFeaturesResponse = {
  linkedFeatures: LinkedFeatureInfo[];
  environments: string[];
};

/** Fetches the features linked to a CB (enriched `LinkedFeatureInfo[]`) for the Linked Features section. */
export function useContextualBanditLinkedFeatures(cbId: string | undefined) {
  const { data, error, mutate } =
    useApi<ContextualBanditLinkedFeaturesResponse>(
      cbId
        ? `/api/v1/contextual-bandits/${cbId}/linked-features`
        : "/api/v1/contextual-bandits/__missing__/linked-features",
      { shouldRun: () => !!cbId },
    );

  return {
    loading: !!cbId && !error && !data,
    linkedFeatures: data?.linkedFeatures ?? [],
    environments: data?.environments ?? [],
    error,
    mutate,
  };
}

/** Health inputs (srm / multipleExposures / totalUsers) driving the CB status badge and Health tab. */
export type ContextualBanditStatusHealth = {
  srm: number | null;
  multipleExposures: number;
  totalUsers: number;
};

/**
 * Resolves the health inputs for a CB's status badge and Health tab.
 */
export function useContextualBanditStatusHealth(
  cb: ApiContextualBanditInterface,
): ContextualBanditStatusHealth | undefined {
  const { results, latest } = useContextualBanditResults(cb.id);
  return useMemo(() => {
    if (latest?.status === "success") {
      const totalUsers = cb.variations.reduce(
        (sum, _v, i) => sum + (results?.overall.variations[i]?.users ?? 0),
        0,
      );
      return {
        srm: latest.srm?.pValue ?? null,
        multipleExposures: latest.multipleExposures ?? 0,
        totalUsers,
      };
    }
    const persisted = cb.analysisSummary?.health;
    if (persisted) {
      return {
        srm: persisted.srm ?? null,
        multipleExposures: persisted.multipleExposures,
        totalUsers: persisted.totalUsers,
      };
    }
    return undefined;
  }, [cb.variations, cb.analysisSummary, results, latest]);
}

/**
 * Computes the CB health issues (Balance / Multiple Exposures) for the current results snapshot.
 */
export function useContextualBanditHealthIssues(
  cb: ApiContextualBanditInterface,
): IssueValue[] {
  const orgSettings = useOrgSettings();
  const health = useContextualBanditStatusHealth(cb);
  const numOfVariations = cb.variations.length;

  return useMemo<IssueValue[]>(() => {
    if (!health) return [];
    const healthSettings = getHealthSettings(orgSettings);
    const resultStatus = getContextualBanditResultStatus({
      srm: health.srm,
      multipleExposures: health.multipleExposures,
      totalUsers: health.totalUsers,
      numOfVariations,
      healthSettings,
    });
    if (resultStatus?.status !== "unhealthy") return [];
    const issues: IssueValue[] = [];
    if (resultStatus.unhealthyData.srm) {
      issues.push({ label: "Balance", value: "balanceCheck" });
    }
    if (resultStatus.unhealthyData.multipleExposures) {
      issues.push({ label: "Multiple Exposures", value: "multipleExposures" });
    }
    return issues;
  }, [health, orgSettings, numOfVariations]);
}
