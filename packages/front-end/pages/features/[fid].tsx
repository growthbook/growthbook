import { useRouter } from "next/router";
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { FeatureCodeRefsInterface } from "back-end/types/code-refs";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  filterEnvironmentsByFeature,
  getDependentExperiments,
  getDependentFeatures,
  mergeRevision,
} from "shared/util";
import { SafeRolloutInterface } from "shared/src/validators/safe-rollout";
import { HoldoutInterface } from "back-end/src/validators/holdout";
import { MinimalFeatureRevisionInterface } from "back-end/src/validators/features";
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

const featureTabs = ["overview", "stats", "test"] as const;
export type FeatureTab = (typeof featureTabs)[number];

export default function FeaturePage() {
  const router = useRouter();
  const orgSettings = useOrgSettings();
  const { fid } = router.query;
  const [editProjectModal, setEditProjectModal] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);
  const [editFeatureInfoModal, setEditFeatureInfoModal] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastDisplayedVersion, setLastDisplayedVersion] = useState<
    number | null
  >(null);

  const { apiCall } = useAuth();

  const { features } = useFeaturesList(false);
  const allEnvironments = useEnvironments();

  const [data, setData] = useState<{
    feature: FeatureInterface | null;
    revisionList: MinimalFeatureRevisionInterface[];
    revisions: FeatureRevisionInterface[];
    experiments: ExperimentInterfaceStringDates[];
    safeRollouts: SafeRolloutInterface[];
    codeRefs: FeatureCodeRefsInterface[];
    holdout: HoldoutInterface | undefined;
  }>({
    feature: null,
    revisionList: [],
    revisions: [],
    experiments: [],
    safeRollouts: [],
    codeRefs: [],
    holdout: undefined,
  });

  const baseFeature = data?.feature;
  const baseFeatureVersion = baseFeature?.version;
  const revisions = data?.revisions;
  const experiments = data?.experiments;
  const safeRollouts = data?.safeRollouts;
  const holdout = data?.holdout;
  const [error, setError] = useState<string | null>(null);
  const { experiments: allExperiments } = useExperiments();

  const fetchData = useCallback(
    async (queryString = "") => {
      const mergeArraysByKey = <T, K extends keyof T>(
        existingArray: T[],
        newArray: T[],
        key: K,
      ): T[] => {
        const keyMap = new Map(existingArray.map((item) => [item[key], item]));

        newArray.forEach((newItem) => {
          keyMap.set(newItem[key], newItem); // Replace or add the new item
        });

        return Array.from(keyMap.values());
      };

      try {
        setLoading(true);

        const response = await apiCall<{
          feature: FeatureInterface;
          revisionList: MinimalFeatureRevisionInterface[];
          revisions: FeatureRevisionInterface[];
          experiments: ExperimentInterfaceStringDates[];
          safeRollouts: SafeRolloutInterface[];
          codeRefs: FeatureCodeRefsInterface[];
          holdout: HoldoutInterface | undefined;
        }>(`/feature/${fid}${queryString}`);

        // Merge new data with existing data
        setData((prevData) => ({
          feature: response.feature,
          revisionList: response.revisionList,
          revisions: mergeArraysByKey<FeatureRevisionInterface, "version">(
            prevData.revisions,
            response.revisions,
            "version",
          ),
          experiments: mergeArraysByKey<ExperimentInterfaceStringDates, "id">(
            prevData.experiments,
            response.experiments,
            "id",
          ),
          safeRollouts: mergeArraysByKey<SafeRolloutInterface, "id">(
            prevData.safeRollouts,
            response.safeRollouts,
            "id",
          ),
          codeRefs: response.codeRefs,
          holdout: response.holdout,
        }));
        setError(null);
      } catch (err) {
        setError(err.message || "An error occurred while fetching data.");
      } finally {
        setLoading(false);
      }
    },
    [fid, apiCall], // Dependencies of fetchData
  );

  // Fetch data on initial load and when the version changes if the version is not in revisions
  useEffect(() => {
    let extraQueryString = "";
    if (version) {
      extraQueryString = `?v=${version}`;
      if (revisions.some((r) => r.version === version)) {
        return;
      }
    } else {
      // If no version is set, the page just loaded and we want to fetch the data for the first time
      // Though fetchData will set the revsions, so to avoid fetching twice on page load we check
      // whether fetchData has already been called by checking if revisions exist
      if (revisions && revisions.length > 0) {
        return;
      }
      // Version being forced via querystring
      if ("v" in router.query) {
        const v = parseInt(router.query.v as string);
        if (v) {
          extraQueryString = `?v=${v}`;
        }
      }
    }
    fetchData(extraQueryString);
  }, [fid, version, revisions, router, fetchData]);

  const [tab, setTab] = useLocalStorage<FeatureTab>(
    `tabbedPageTab__${fid}`,
    "overview",
  );

  const setTabAndScroll = (tab: FeatureTab) => {
    setTab(tab);
    const newUrl = window.location.href.replace(/#.*/, "") + "#" + tab;
    if (newUrl === window.location.href) return;
    window.history.pushState("", "", newUrl);
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

  // Set the initial version (once we have the data) based on the query string or the active draft
  useEffect(() => {
    if (!revisions || !baseFeatureVersion) return;
    if (version) return;

    // Version being forced via querystring
    if ("v" in router.query) {
      const v = parseInt(router.query.v as string);
      if (v && revisions.some((r) => r.version === v)) {
        setVersion(v);
        return;
      }
    }

    // If there's an active draft, show that by default, otherwise show the live version
    const draft = revisions.find(
      (r) =>
        r.status === "draft" ||
        r.status === "approved" ||
        r.status === "changes-requested" ||
        r.status === "pending-review",
    );
    setVersion(draft ? draft.version : baseFeatureVersion);
  }, [revisions, version, router.query, baseFeatureVersion]);

  const environments = useMemo(
    () =>
      baseFeature
        ? filterEnvironmentsByFeature(allEnvironments, baseFeature)
        : [],
    [allEnvironments, baseFeature],
  );
  const envs = environments.map((e) => e.id);

  const revision = useMemo<FeatureRevisionInterface | null>(() => {
    if (!revisions || !version || !baseFeature) return null;
    const match = revisions.find((r) => r.version === version);
    if (match) {
      setLastDisplayedVersion(match.version);
      return match;
    } else if (lastDisplayedVersion) {
      // Keep showing the most recently displayed version until the data is fetched
      const lastMatch = revisions.find(
        (r) => r.version === lastDisplayedVersion,
      );
      if (lastMatch) {
        return lastMatch;
      }
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
  }, [revisions, version, environments, baseFeature, lastDisplayedVersion]);

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
    return <div className="alert alert-danger">An error occurred: {error}</div>;
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
        mutate={() => fetchData()}
        tab={tab}
        setTab={setTabAndScroll}
        setEditFeatureInfoModal={setEditFeatureInfoModal}
        dependents={dependents}
        holdout={holdout}
        dependentExperiments={dependentExperiments}
      />

      {tab === "overview" && (
        <FeaturesOverview
          baseFeature={baseFeature}
          feature={feature}
          revision={revision}
          revisionList={data.revisionList}
          loading={loading}
          revisions={data.revisions}
          experiments={experiments}
          safeRollouts={safeRollouts}
          holdout={holdout}
          mutate={() => fetchData()}
          editProjectModal={editProjectModal}
          setEditProjectModal={setEditProjectModal}
          version={version}
          setVersion={setVersion}
          dependents={dependents}
          dependentFeatures={dependentFeatures}
          dependentExperiments={dependentExperiments}
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
          mutate={() => fetchData()}
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
          mutate={() => fetchData()}
        />
      )}
    </FeatureUsageProvider>
  );
}
