import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { FeatureEvalDiagnosticsQueryResponseRows } from "shared/types/integrations";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import FeaturesHeader from "@/components/Features/FeaturesHeader";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import FeaturesOverview from "@/components/Features/FeaturesOverview";
import FeaturesStats from "@/components/Features/FeaturesStats";
import useOrgSettings from "@/hooks/useOrgSettings";
import { FeatureUsageProvider } from "@/components/Features/FeatureUsageGraph";
import FeatureTest from "@/components/Features/FeatureTest";
import { useAuth } from "@/services/auth";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import EditFeatureInfoModal from "@/components/Features/EditFeatureInfoModal";
import FeatureDiagnostics from "@/components/Features/FeatureDiagnostics";
import { useFeaturePageData } from "@/hooks/useFeaturePageData";
import { useFeatureDependents } from "@/hooks/useFeatureDependents";
import Callout from "@/ui/Callout";

const featureTabs = ["overview", "stats", "test", "diagnostics"] as const;
export type FeatureTab = (typeof featureTabs)[number];

export default function FeaturePage() {
  const router = useRouter();
  const orgSettings = useOrgSettings();
  const { fid } = router.query;
  const [editProjectModal, setEditProjectModal] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);
  const [editFeatureInfoModal, setEditFeatureInfoModal] = useState(false);
  const [diagnosticsResults, setDiagnosticsResults] = useState<Array<
    FeatureEvalDiagnosticsQueryResponseRows[number] & { id: string }
  > | null>(null);
  // Clean state when feature id changes
  useEffect(() => {
    setDiagnosticsResults(null);
  }, [fid]);

  const { apiCall } = useAuth();

  const {
    data,
    error,
    isValidating,
    revisionLoading,
    refreshData,
    feature,
    baseFeature,
    revision,
    version,
    setVersion,
  } = useFeaturePageData(fid, router.query.v);

  const experiments = data?.experiments;
  const safeRollouts = data?.safeRollouts;
  const holdout = data?.holdout;

  const { dependents: dependentsData } = useFeatureDependents(baseFeature?.id);

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

  const dependents =
    (dependentsData?.features.length ?? 0) +
    (dependentsData?.experiments.length ?? 0);

  if (error) {
    return <Callout status="error">An error occurred: {error.message}</Callout>;
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
        mutate={refreshData}
        tab={tab}
        setTab={setTabAndScroll}
        setEditFeatureInfoModal={setEditFeatureInfoModal}
        holdout={holdout}
      />

      {tab === "overview" && (
        <FeaturesOverview
          baseFeature={baseFeature}
          feature={feature}
          revision={revision}
          revisionList={data.revisionList}
          loading={isValidating}
          revisionLoading={revisionLoading}
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
