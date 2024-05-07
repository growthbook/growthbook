import { useRouter } from "next/router";
import { useEffect, useState, useMemo } from "react";
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
import LoadingOverlay from "@/components/LoadingOverlay";
import useApi from "@/hooks/useApi";
import PageHead from "@/components/Layout/PageHead";
import FeaturesHeader from "@/components/Features/FeaturesHeader";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import FeaturesOverview from "@/components/Features/FeaturesOverview";
import FeaturesStats from "@/components/Features/FeaturesStats";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useEnvironments, useFeaturesList } from "@/services/features";

const featureTabs = ["overview", "stats"] as const;
export type FeatureTab = (typeof featureTabs)[number];

export default function FeaturePage() {
  const router = useRouter();
  const orgSettings = useOrgSettings();
  const { fid } = router.query;
  const [editProjectModal, setEditProjectModal] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);
  const [version, setVersion] = useState<number | null>(null);

  const { features } = useFeaturesList(false);
  const allEnvironments = useEnvironments();

  let extraQueryString = "";
  // Version being forced via querystring
  if ("v" in router.query) {
    const v = parseInt(router.query.v as string);
    if (v) {
      extraQueryString = `?v=${v}`;
    }
  }

  const { data, error, mutate } = useApi<{
    feature: FeatureInterface;
    revisions: FeatureRevisionInterface[];
    experiments: ExperimentInterfaceStringDates[];
    codeRefs: FeatureCodeRefsInterface[];
  }>(`/feature/${fid}${extraQueryString}`);
  const baseFeature = data?.feature;
  const baseFeatureVersion = baseFeature?.version;
  const revisions = data?.revisions;
  const experiments = data?.experiments;

  const [tab, setTab] = useLocalStorage<FeatureTab>(
    `tabbedPageTab__${data?.feature?.id}`,
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
    if (match) return match;

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
  }, [revisions, version, environments, baseFeature]);

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
    if (!feature || !experiments) return [];
    return getDependentExperiments(feature, experiments);
  }, [feature, experiments]);

  const dependents = dependentFeatures.length + dependentExperiments.length;

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }

  if (!data || !feature || !revision) {
    return <LoadingOverlay />;
  }

  return (
    <>
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
        mutate={mutate}
        tab={tab}
        setTab={setTabAndScroll}
        setEditProjectModal={setEditProjectModal}
        setEditTagsModal={setEditTagsModal}
        setEditOwnerModal={setEditOwnerModal}
        dependents={dependents}
      />

      {tab === "overview" && (
        <FeaturesOverview
          baseFeature={data.feature}
          feature={feature}
          revision={revision}
          revisions={data.revisions}
          experiments={experiments}
          mutate={mutate}
          editProjectModal={editProjectModal}
          setEditProjectModal={setEditProjectModal}
          editTagsModal={editTagsModal}
          setEditTagsModal={setEditTagsModal}
          editOwnerModal={editOwnerModal}
          setEditOwnerModal={setEditOwnerModal}
          version={version}
          setVersion={setVersion}
          dependents={dependents}
          dependentFeatures={dependentFeatures}
          dependentExperiments={dependentExperiments}
        />
      )}

      {tab === "stats" && (
        <FeaturesStats orgSettings={orgSettings} codeRefs={data.codeRefs} />
      )}
    </>
  );
}
