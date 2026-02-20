import { useRouter } from "next/router";
import { useEffect, useState, useMemo } from "react";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureCodeRefsInterface } from "shared/types/code-refs";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  filterEnvironmentsByFeature,
  getDependentExperiments,
  getDependentFeatures,
  mergeRevision,
} from "shared/util";
import {
  SafeRolloutInterface,
  HoldoutInterface,
  MinimalFeatureRevisionInterface,
} from "shared/validators";
import { FeatureEvalDiagnosticsQueryResponseRows } from "shared/types/integrations";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import FeaturesHeader from "@/components/Features/FeaturesHeader";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import FeaturesOverview from "@/components/Features/FeaturesOverview";
import FeaturesStats from "@/components/Features/FeaturesStats";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useEnvironments, useFeaturesList } from "@/services/features";
import { FeatureUsageProvider } from "@/components/Features/FeatureUsageGraph";
import FeatureTest from "@/components/Features/FeatureTest";
import { useAuth } from "@/services/auth";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import EditFeatureInfoModal from "@/components/Features/EditFeatureInfoModal";
import { useExperiments } from "@/hooks/useExperiments";
import FeatureDiagnostics from "@/components/Features/FeatureDiagnostics";
import useApi from "@/hooks/useApi";

const featureTabs = ["overview", "stats", "test", "diagnostics"] as const;
export type FeatureTab = (typeof featureTabs)[number];

type FeaturePageResponse = {
  feature: FeatureInterface | null;
  revisionList: MinimalFeatureRevisionInterface[];
  revisions: FeatureRevisionInterface[];
  experiments: ExperimentInterfaceStringDates[];
  safeRollouts: SafeRolloutInterface[];
  codeRefs: FeatureCodeRefsInterface[];
  holdout: HoldoutInterface | undefined;
};

function parseVersion(value: string | string[] | undefined): number | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  const parsed = parseInt(v, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export default function FeaturePage() {
  const router = useRouter();
  const orgSettings = useOrgSettings();
  const { fid } = router.query;
  const [editProjectModal, setEditProjectModal] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);
  const [editFeatureInfoModal, setEditFeatureInfoModal] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [diagnosticsResults, setDiagnosticsResults] = useState<Array<
    FeatureEvalDiagnosticsQueryResponseRows[number] & { id: string }
  > | null>(null);

  // To ensure that when we navigate between versions we don't refetch them if it is not needed
  const [cachedRevisionsByVersion, setCachedRevisionsByVersion] = useState<
    Record<number, FeatureRevisionInterface>
  >({});
  const [cachedExperimentsById, setCachedExperimentsById] = useState<
    Record<string, ExperimentInterfaceStringDates>
  >({});
  const [cachedSafeRolloutsById, setCachedSafeRolloutsById] = useState<
    Record<string, SafeRolloutInterface>
  >({});

  const { apiCall } = useAuth();
  const { experiments: allExperiments } = useExperiments();

  const forcedVersionFromQuery = useMemo(
    () => parseVersion(router.query.v),
    [router.query.v],
  );
  const selectedVersion = version ?? forcedVersionFromQuery;

  const {
    data: baseData,
    error: baseError,
    mutate: mutateBase,
    isValidating: isValidatingBase,
  } = useApi<FeaturePageResponse>(fid ? `/feature/${fid}` : "", {
    shouldRun: () => !!fid,
  });

  const shouldFetchSelectedVersion =
    fid !== undefined &&
    selectedVersion !== null &&
    !(
      (baseData?.revisions ?? []).some((r) => r.version === selectedVersion) ||
      !!cachedRevisionsByVersion[selectedVersion]
    );

  const {
    data: selectedVersionData,
    error: selectedVersionError,
    mutate: mutateSelectedVersion,
    isValidating: isValidatingSelectedVersion,
  } = useApi<FeaturePageResponse>(
    fid && selectedVersion ? `/feature/${fid}?v=${selectedVersion}` : "",
    {
      shouldRun: () => shouldFetchSelectedVersion,
    },
  );

  // Ensure we reset everything if feature id changes
  useEffect(() => {
    if (!fid) return;
    setVersion(null);
    setDiagnosticsResults(null);
    setCachedRevisionsByVersion({});
    setCachedExperimentsById({});
    setCachedSafeRolloutsById({});
  }, [fid]);

  const refreshData = async () => {
    await mutateBase();
    if (shouldFetchSelectedVersion) {
      await mutateSelectedVersion();
    }
  };

  useEffect(() => {
    if (!baseData || !baseData.feature || baseData.feature.id !== fid) {
      return;
    }

    setCachedRevisionsByVersion((prev) => {
      const next = { ...prev };
      baseData.revisions.forEach((r) => {
        next[r.version] = r;
      });
      return next;
    });

    setCachedExperimentsById((prev) => {
      const next = { ...prev };
      baseData.experiments.forEach((e) => {
        next[e.id] = e;
      });
      return next;
    });

    setCachedSafeRolloutsById((prev) => {
      const next = { ...prev };
      baseData.safeRollouts.forEach((sr) => {
        next[sr.id] = sr;
      });
      return next;
    });
  }, [baseData, fid]);

  useEffect(() => {
    if (
      !selectedVersionData ||
      !selectedVersionData.feature ||
      selectedVersionData.feature.id !== fid
    ) {
      return;
    }

    setCachedRevisionsByVersion((prev) => {
      const next = { ...prev };
      selectedVersionData.revisions.forEach((r) => {
        next[r.version] = r;
      });
      return next;
    });
    setCachedExperimentsById((prev) => {
      const next = { ...prev };
      selectedVersionData.experiments.forEach((e) => {
        next[e.id] = e;
      });
      return next;
    });
    setCachedSafeRolloutsById((prev) => {
      const next = { ...prev };
      selectedVersionData.safeRollouts.forEach((sr) => {
        next[sr.id] = sr;
      });
      return next;
    });
  }, [selectedVersionData, fid]);

  const data = useMemo<FeaturePageResponse | undefined>(() => {
    const source = baseData ?? selectedVersionData;
    if (!source) return undefined;

    return {
      ...source,
      revisions: Object.values(cachedRevisionsByVersion),
      experiments: Object.values(cachedExperimentsById),
      safeRollouts: Object.values(cachedSafeRolloutsById),
    };
  }, [
    baseData,
    selectedVersionData,
    cachedRevisionsByVersion,
    cachedExperimentsById,
    cachedSafeRolloutsById,
  ]);
  const error = selectedVersionError ?? baseError;
  const isValidating = isValidatingBase || isValidatingSelectedVersion;

  const baseFeature = data?.feature;
  const baseFeatureVersion = baseFeature?.version;
  const revisions = data?.revisions;
  const experiments = data?.experiments;
  const safeRollouts = data?.safeRollouts;
  const holdout = data?.holdout;

  // Scope stale detection to the current feature's project
  const { features } = useFeaturesList({
    project: baseFeature?.project,
    skipFetch: !baseFeature,
  });
  const allEnvironments = useEnvironments();

  const [tab, setTab] = useLocalStorage<FeatureTab>(
    `tabbedPageTab__${fid}`,
    "overview",
  );

  const setTabAndScroll = (tab: FeatureTab) => {
    setTab(tab);
    const newUrl = window.location.href.replace(/#.*/, "") + "#" + tab;
    if (newUrl === window.location.href) return;
    router.push(newUrl, undefined, { shallow: true });
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  useEffect(() => {
    const handler = () => {
      const hash = window.location.hash.replace(/^#/, "") as FeatureTab;
      if (featureTabs.includes(hash)) {
        setTab(hash);
      }
    };
    handler();
    window.addEventListener("hashchange", handler, false);
    return () => window.removeEventListener("hashchange", handler, false);
  }, [setTab]);

  // Set the initial selected version once data is available.
  useEffect(() => {
    if (!baseFeatureVersion || version !== null) return;

    if (forcedVersionFromQuery) {
      if (
        revisions &&
        revisions.some((r) => r.version === forcedVersionFromQuery)
      ) {
        setVersion(forcedVersionFromQuery);
      }
      return;
    }

    // If there's an active draft, show that by default, otherwise show the live version
    const draft =
      revisions &&
      revisions.find(
        (r) =>
          r.status === "draft" ||
          r.status === "approved" ||
          r.status === "changes-requested" ||
          r.status === "pending-review",
      );
    setVersion(draft ? draft.version : baseFeatureVersion);
  }, [revisions, version, forcedVersionFromQuery, baseFeatureVersion]);

  const environments = useMemo(
    () =>
      baseFeature
        ? filterEnvironmentsByFeature(allEnvironments, baseFeature)
        : [],
    [allEnvironments, baseFeature],
  );
  const envs = environments.map((e) => e.id);

  const revision = useMemo<FeatureRevisionInterface | null>(() => {
    if (!baseFeature) return null;

    const currentVersion =
      version ?? forcedVersionFromQuery ?? baseFeature.version ?? null;

    if (!currentVersion) return null;

    const match =
      revisions && revisions.find((r) => r.version === currentVersion);
    if (match) {
      return match;
    }

    // If we can't find the revision, create a dummy revision just so the page can render
    // This is for old features that don't have any revision history saved
    const rules: Record<string, FeatureRule[]> = {};
    environments.forEach((env) => {
      rules[env.id] = baseFeature.environmentSettings?.[env.id]?.rules || [];
    });
    return {
      baseVersion: baseFeature.version,
      comment: "",
      createdBy: null,
      dateCreated: baseFeature.dateCreated,
      datePublished: baseFeature.dateCreated,
      dateUpdated: baseFeature.dateUpdated,
      defaultValue: baseFeature.defaultValue,
      featureId: baseFeature.id,
      organization: baseFeature.organization,
      publishedBy: null,
      rules: rules,
      status: "published",
      version: baseFeature.version,
      prerequisites: baseFeature.prerequisites || [],
    };
  }, [revisions, version, forcedVersionFromQuery, environments, baseFeature]);

  const feature = useMemo(() => {
    if (!revision || !baseFeature) return null;
    return revision.version !== baseFeature.version
      ? mergeRevision(
          baseFeature,
          revision,
          environments.map((e) => e.id),
        )
      : baseFeature;
  }, [baseFeature, revision, environments]);

  // note: project-scoped dependents by default
  const dependentFeatures = useMemo(() => {
    if (!feature || !features) return [];
    return getDependentFeatures(feature, features, envs);
  }, [feature, features, envs]);

  const dependentExperiments = useMemo(() => {
    if (!feature || !allExperiments) return [];
    return getDependentExperiments(feature, allExperiments);
  }, [feature, allExperiments]);

  const dependents = dependentFeatures.length + dependentExperiments.length;

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }

  if (!data || !feature || !revision || !baseFeature) {
    return <LoadingOverlay />;
  }

  return (
    <FeatureUsageProvider feature={feature}>
      <PageHead
        breadcrumb={[
          { display: "Features", href: "/features" },
          { display: feature.id },
        ]}
      />
      <FeaturesHeader
        feature={feature}
        features={features}
        experiments={experiments}
        mutate={refreshData}
        tab={tab}
        setTab={setTabAndScroll}
        setEditFeatureInfoModal={setEditFeatureInfoModal}
        holdout={holdout}
        dependentExperiments={dependentExperiments}
      />

      {tab === "overview" && (
        <FeaturesOverview
          baseFeature={baseFeature}
          feature={feature}
          revision={revision}
          revisionList={data.revisionList}
          loading={isValidating}
          revisions={data.revisions}
          experiments={experiments}
          safeRollouts={safeRollouts}
          holdout={holdout}
          mutate={refreshData}
          editProjectModal={editProjectModal}
          setEditProjectModal={setEditProjectModal}
          version={version}
          setVersion={setVersion}
        />
      )}

      {tab === "test" && (
        <FeatureTest
          baseFeature={baseFeature}
          feature={feature}
          revision={revision}
          revisions={data.revisionList}
          version={version}
          setVersion={setVersion}
        />
      )}

      {tab === "stats" && (
        <FeaturesStats orgSettings={orgSettings} codeRefs={data.codeRefs} />
      )}

      {tab === "diagnostics" && (
        <FeatureDiagnostics
          feature={feature}
          results={diagnosticsResults}
          setResults={setDiagnosticsResults}
        />
      )}

      {editTagsModal && (
        <EditTagsForm
          tags={feature.tags || []}
          save={async (tags) => {
            await apiCall(`/feature/${feature.id}`, {
              method: "PUT",
              body: JSON.stringify({ tags }),
            });
          }}
          cancel={() => setEditTagsModal(false)}
          mutate={refreshData}
        />
      )}

      {editFeatureInfoModal && (
        <EditFeatureInfoModal
          resourceType="feature"
          source="feature-header"
          dependents={dependents}
          feature={feature}
          save={async (updates) => {
            await apiCall(`/feature/${feature.id}`, {
              method: "PUT",
              body: JSON.stringify({ ...updates }),
            });
          }}
          cancel={() => setEditFeatureInfoModal(false)}
          mutate={refreshData}
        />
      )}
    </FeatureUsageProvider>
  );
}
