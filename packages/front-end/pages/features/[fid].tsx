import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { FeatureEvalDiagnosticsQueryResponseRows } from "shared/types/integrations";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import FeaturesHeader from "@/components/Features/FeaturesHeader";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import FeaturesOverview from "@/components/Features/FeaturesOverview";
import FeaturesStats from "@/components/Features/FeaturesStats";
import useOrgSettings from "@/hooks/useOrgSettings";
import { FeatureUsageProvider } from "@/components/Features/FeatureUsageGraph";
import FeatureTest from "@/components/Features/FeatureTest";
import ReviewAndPublish from "@/components/Reviews/Feature/ReviewAndPublish";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import EditFeatureInfoModal from "@/components/Features/EditFeatureInfoModal";
import FeatureDiagnostics from "@/components/Features/FeatureDiagnostics";
import FeatureValidationTab from "@/components/Features/FeatureValidationTab";
import CompareRevisionsModal from "@/components/Reviews/Feature/CompareRevisionsModal";
import { useFeaturePageData } from "@/hooks/useFeaturePageData";
import { useFeatureDependents } from "@/hooks/useFeatureDependents";
import Callout from "@/ui/Callout";
import { FeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";

const featureTabs = [
  "overview",
  "review",
  "stats",
  "test",
  "diagnostics",
  "validation",
] as const;
export type FeatureTab = (typeof featureTabs)[number];

export default function FeaturePage() {
  const router = useRouter();
  const orgSettings = useOrgSettings();
  const { fid } = router.query;
  const [editProjectModal, setEditProjectModal] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);
  const [editFeatureInfoModal, setEditFeatureInfoModal] = useState(false);
  const [compareRevisionsOpen, setCompareRevisionsOpen] = useState(false);
  const [diagnosticsResults, setDiagnosticsResults] = useState<Array<
    FeatureEvalDiagnosticsQueryResponseRows[number] & { id: string }
  > | null>(null);

  // Clean state when feature id changes
  useEffect(() => {
    setDiagnosticsResults(null);
  }, [fid]);

  const { apiCall } = useAuth();
  const { userId } = useUser();

  const {
    data,
    error,
    refreshData,
    feature,
    baseFeature,
    revision,
    version,
    setVersion,
  } = useFeaturePageData(fid, router.query.v, userId);

  // Always reflects the current live version — read inside the post-publish
  // callback to avoid the stale closure capture of `baseFeature.version`, which
  // still holds the previously-live version at the time the tab rendered.
  const liveVersionRef = useRef<number | null>(null);
  liveVersionRef.current = baseFeature?.version ?? null;

  const queryV = router.query.v;
  useEffect(() => {
    if (!router.isReady || queryV === undefined) return;
    const parsed = parseInt(String(queryV), 10);
    if (isNaN(parsed) || parsed === version) return;
    if (data?.revisionList?.some((r) => r.version === parsed)) {
      setVersion(parsed);
    }
  }, [queryV, data?.revisionList]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (version === null || !router.isReady) return;
    if (queryV === String(version)) return;
    const isCorrection =
      queryV !== undefined &&
      !data?.revisionList?.some(
        (r) => r.version === parseInt(String(queryV), 10),
      );
    const method =
      queryV === undefined || isCorrection ? router.replace : router.push;
    // Read the live hash rather than router.asPath: review sub-tab changes
    // update the hash via replaceState (useURLHash), which the Next router
    // doesn't observe — asPath would resurrect a stale hash here.
    const hash =
      (typeof window !== "undefined"
        ? window.location.hash.slice(1)
        : new URL(router.asPath, "http://x").hash.slice(1)) || undefined;
    void method(
      {
        pathname: router.pathname,
        query: { ...router.query, v: version },
        hash,
      },
      undefined,
      { shallow: true },
    );
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const experiments = data?.experiments;
  const safeRollouts = data?.safeRollouts;
  const holdout = data?.holdout;
  const rampSchedules = data?.rampSchedules;

  const { dependents: dependentsData } = useFeatureDependents(baseFeature?.id);

  const [tab, setTab] = useLocalStorage<FeatureTab>(
    `tabbedPageTab__${fid}`,
    "overview",
  );

  const setTabAndScroll = (tab: FeatureTab) => {
    setTab(tab);
    void router.push(
      { pathname: router.pathname, query: router.query, hash: tab },
      undefined,
      { shallow: true },
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    // The review tab encodes a sub-tab after a comma (`#review,changes`);
    // only the first segment selects the page-level tab.
    const hash = (new URL(router.asPath, "http://x").hash
      .slice(1)
      .split(",")[0] || undefined) as FeatureTab | undefined;
    if (hash && featureTabs.includes(hash)) {
      setTab(hash);
    }
  }, [router.asPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const dependents =
    (dependentsData?.features.length ?? 0) +
    (dependentsData?.experiments.length ?? 0);

  if (error) {
    return <Callout status="error">An error occurred: {error.message}</Callout>;
  }

  if (!data || !feature || !revision || !baseFeature) {
    return <LoadingOverlay />;
  }

  const viewingDraft = (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(
    revision.status,
  );
  const viewingLive = revision.version === feature.version;

  return (
    <FeatureRevisionsContext.Provider
      value={{
        revisions: data.revisions,
        baseFeature,
        currentVersion: version ?? baseFeature.version,
      }}
    >
      <FeatureUsageProvider feature={feature}>
        <PageHead
          breadcrumb={[
            { display: "Feature Flags", href: "/features" },
            { display: feature.id },
          ]}
        />
        <FeaturesHeader
          feature={feature}
          mutate={refreshData}
          setVersion={setVersion}
          version={version}
          revisions={data.revisionList || []}
          tab={tab}
          setTab={setTabAndScroll}
          setEditFeatureInfoModal={setEditFeatureInfoModal}
          holdout={holdout}
          isReadOnly={
            revision.status === "discarded" ||
            (revision.status === "published" &&
              revision.version !== feature.version)
          }
          onCompareRevisions={
            (data.revisionList?.length ?? 0) >= 2
              ? () => setCompareRevisionsOpen(true)
              : undefined
          }
        />

        {tab === "overview" && (
          <FeaturesOverview
            baseFeature={baseFeature}
            feature={feature}
            revision={revision}
            revisionList={data.revisionList}
            revisions={data.revisions}
            experiments={experiments}
            safeRollouts={safeRollouts}
            holdout={holdout}
            rampSchedules={rampSchedules}
            mutate={refreshData}
            editProjectModal={editProjectModal}
            setEditProjectModal={setEditProjectModal}
            version={version}
            setVersion={setVersion}
            setTab={setTabAndScroll}
          />
        )}

        {tab === "review" && (
          <ReviewAndPublish
            feature={baseFeature}
            revisions={data.revisions}
            revisionList={data.revisionList || []}
            version={version ?? baseFeature.version}
            setVersion={setVersion}
            experiments={experiments}
            rampSchedules={rampSchedules}
            mutate={refreshData}
            onPublish={() => {
              setTimeout(() => {
                if (liveVersionRef.current !== null) {
                  setVersion(liveVersionRef.current);
                }
              }, 300);
            }}
            onCompareRevisions={
              (data.revisionList?.length ?? 0) >= 2
                ? () => setCompareRevisionsOpen(true)
                : undefined
            }
          />
        )}

        {tab === "test" && (
          <FeatureTest
            baseFeature={baseFeature}
            feature={feature}
            revision={revision}
            version={version}
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

        {tab === "validation" && (
          <FeatureValidationTab
            feature={feature}
            revision={revision}
            mutate={refreshData}
            setVersion={setVersion}
            revisionList={data.revisionList}
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

        {compareRevisionsOpen && (
          <CompareRevisionsModal
            feature={feature}
            baseFeature={baseFeature}
            revisionList={data.revisionList || []}
            revisions={data.revisions}
            currentVersion={version ?? feature.version}
            onClose={() => setCompareRevisionsOpen(false)}
            initialPreviewDraft={
              viewingDraft ? (version ?? undefined) : undefined
            }
            initialMode={
              viewingLive && !viewingDraft ? "most-recent-live" : undefined
            }
            rampSchedules={rampSchedules}
          />
        )}

        {editFeatureInfoModal && (
          <EditFeatureInfoModal
            source="feature-header"
            dependents={dependents}
            feature={feature}
            revisionList={data.revisionList || []}
            cancel={() => setEditFeatureInfoModal(false)}
            mutate={refreshData}
            setVersion={setVersion}
          />
        )}
      </FeatureUsageProvider>
    </FeatureRevisionsContext.Provider>
  );
}
