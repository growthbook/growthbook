import { useRouter } from "next/router";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { useEffect, useRef, useState } from "react";
import { FeatureEvalDiagnosticsQueryResponseRows } from "shared/types/integrations";
import { isActiveDraftStatus } from "shared/validators";
import { isRevisionEditLockedBySchedule } from "shared/enterprise";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import FeaturesHeader from "@/components/Features/FeaturesHeader";
import FeaturesHeaderNew from "@/components/Features/FeaturesHeaderNew";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import FeaturesOverview from "@/components/Features/FeaturesOverview";
import FeaturesOverviewNew from "@/components/Features/FeaturesOverviewNew";
import EditFeatureInfoModal from "@/components/Features/EditFeatureInfoModal";
import { FeaturePageRedesignContext } from "@/components/Features/FeaturePageRedesign";
import FeaturesStats from "@/components/Features/FeaturesStats";
import useOrgSettings from "@/hooks/useOrgSettings";
import { FeatureUsageProvider } from "@/components/Features/FeatureUsageGraph";
import FeatureTest from "@/components/Features/FeatureTest";
import ReviewAndPublish from "@/components/Reviews/Feature/ReviewAndPublish";
import { useUser } from "@/services/UserContext";
import FeatureDiagnostics from "@/components/Features/FeatureDiagnostics";
import FeatureValidationTab from "@/components/Features/FeatureValidationTab";
import CompareRevisionsModal from "@/components/Reviews/Feature/CompareRevisionsModal";
import { useFeaturePageData } from "@/hooks/useFeaturePageData";
import { useFeatureDependents } from "@/hooks/useFeatureDependents";
import Callout from "@/ui/Callout";
import { FeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";
import { DetailsPanelLayout, useDetailsPanel } from "@/components/DetailsPanel";
import FeatureDetailsPanel from "@/components/Features/FeatureDetailsPanel";
import { SCHEDULE_EDIT_LOCK_REASON } from "@/components/Features/ScheduleLock";
import RevisionStatusBar, {
  REVISION_STATUS_BAR_HEIGHT_PX,
} from "@/components/Features/RevisionStatusBar";
import { getRevisionStatus } from "@/services/revisionStatus";
import {
  TABS_BAR_HEIGHT_PX,
  TABS_HEADER_HEIGHT_PX,
} from "@/components/Layout/constants";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

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
  const permissionsUtil = usePermissionsUtil();
  const [compareRevisionsOpen, setCompareRevisionsOpen] = useState(false);
  const [diagnosticsResults, setDiagnosticsResults] = useState<Array<
    FeatureEvalDiagnosticsQueryResponseRows[number] & { id: string }
  > | null>(null);

  // Clean state when feature id changes
  useEffect(() => {
    setDiagnosticsResults(null);
  }, [fid]);

  const { userId } = useUser();
  // The redesign, tested against the page it replaces.
  const redesign = useFeatureIsOn("feature-page-redesign-v1");
  const [editProjectModal, setEditProjectModal] = useState(false);
  const [editFeatureInfoModal, setEditFeatureInfoModal] = useState(false);

  const {
    data,
    error,
    refreshData,
    feature,
    baseFeature,
    revision,
    version,
    setVersion,
    loadRevisions,
    unavailableVersions,
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

  // Open state is remembered per feature; width is a global preference.
  const details = useDetailsPanel({
    openKey: `feature-details-panel-open__${fid}`,
    widthKey: "feature-details-panel-width",
    tab,
    homeTab: "overview",
  });

  if (error) {
    return <Callout status="error">An error occurred: {error.message}</Callout>;
  }

  if (!data || !feature || !revision || !baseFeature) {
    return <LoadingOverlay />;
  }

  const viewingDraft = isActiveDraftStatus(revision.status);
  const viewingLive = revision.version === feature.version;
  // Under the tabs, the status bar pushes down what sticks beneath them.
  // Only on the overview, where the revision's content is.
  const showsStatusBar =
    tab === "overview" &&
    getRevisionStatus({
      revision,
      liveVersion: baseFeature.version,
      revisionList: data.revisionList || [],
    }) !== null;
  const stickyTop =
    TABS_HEADER_HEIGHT_PX +
    TABS_BAR_HEIGHT_PX +
    (showsStatusBar ? REVISION_STATUS_BAR_HEIGHT_PX : 0);
  const isReadOnly =
    revision.status === "discarded" ||
    (revision.status === "published" && !viewingLive);

  const compareRevisions =
    (data.revisionList?.length ?? 0) >= 2
      ? () => setCompareRevisionsOpen(true)
      : undefined;

  // Every tab but the overview is the same in both versions of the page.
  const otherTabs = (
    <>
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
        <FeaturesStats orgSettings={orgSettings} featureId={feature.id} />
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
    </>
  );

  const compareModal = compareRevisionsOpen ? (
    <CompareRevisionsModal
      feature={feature}
      baseFeature={baseFeature}
      revisionList={data.revisionList || []}
      revisions={data.revisions}
      currentVersion={version ?? feature.version}
      onClose={() => setCompareRevisionsOpen(false)}
      initialPreviewDraft={viewingDraft ? (version ?? undefined) : undefined}
      initialMode={
        viewingLive && !viewingDraft ? "most-recent-live" : undefined
      }
      rampSchedules={rampSchedules}
    />
  ) : null;

  const page = !redesign ? (
    <>
      <FeaturesHeader
        feature={feature}
        baseFeature={baseFeature}
        mutate={refreshData}
        setVersion={setVersion}
        version={version}
        revisions={data.revisionList || []}
        tab={tab}
        setTab={setTabAndScroll}
        setEditFeatureInfoModal={setEditFeatureInfoModal}
        holdout={holdout}
        isReadOnly={isReadOnly}
        onCompareRevisions={compareRevisions}
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
      {otherTabs}
      {editFeatureInfoModal && (
        <EditFeatureInfoModal
          baseFeature={baseFeature}
          source="feature-header"
          dependents={
            (dependentsData?.features.length ?? 0) +
            (dependentsData?.experiments.length ?? 0)
          }
          feature={feature}
          revisionList={data.revisionList || []}
          cancel={() => setEditFeatureInfoModal(false)}
          mutate={refreshData}
          setVersion={setVersion}
        />
      )}
    </>
  ) : (
    <>
      <FeaturesHeaderNew
        feature={feature}
        baseFeature={baseFeature}
        mutate={refreshData}
        setVersion={setVersion}
        version={version}
        revisions={data.revisionList || []}
        tab={tab}
        setTab={setTabAndScroll}
        holdout={holdout}
        isReadOnly={isReadOnly}
        onCompareRevisions={compareRevisions}
        detailsOpen={details.open}
        setDetailsOpen={details.toggle}
        statusBar={
          showsStatusBar ? (
            <RevisionStatusBar
              baseFeature={baseFeature}
              revision={revision}
              revisionList={data.revisionList || []}
              setTab={setTabAndScroll}
              setVersion={setVersion}
              mutate={refreshData}
            />
          ) : null
        }
      />
      <DetailsPanelLayout
        details={details}
        stickyTop={stickyTop}
        panel={
          <FeatureDetailsPanel
            feature={feature}
            baseFeature={baseFeature}
            revision={revision}
            revisionList={data.revisionList || []}
            holdout={holdout}
            dependents={dependentsData}
            canEdit={
              permissionsUtil.canEditFeatureDrafts(baseFeature) && !isReadOnly
            }
            blockedReason={
              viewingDraft && isRevisionEditLockedBySchedule(revision)
                ? SCHEDULE_EDIT_LOCK_REASON
                : null
            }
            mutate={refreshData}
            setVersion={setVersion}
            tab={details.panelTab}
            setTab={details.setPanelTab}
          />
        }
      >
        <div className="feature-column">
          {tab === "overview" && (
            <FeaturesOverviewNew
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
              version={version}
              setVersion={setVersion}
              stickyTop={stickyTop}
            />
          )}
          {otherTabs}
        </div>
      </DetailsPanelLayout>
    </>
  );

  return (
    <FeatureRevisionsContext.Provider
      value={{
        revisions: data.revisions,
        baseFeature,
        currentVersion: version ?? baseFeature.version,
        loadRevisions,
        unavailableVersions,
      }}
    >
      <FeatureUsageProvider feature={feature}>
        <PageHead
          breadcrumb={[
            { display: "Feature Flags", href: "/features" },
            { display: feature.id },
          ]}
        />
        <FeaturePageRedesignContext.Provider value={redesign}>
          {page}
        </FeaturePageRedesignContext.Provider>
        {compareModal}
      </FeatureUsageProvider>
    </FeatureRevisionsContext.Provider>
  );
}

// Runs the window's full width, beside the details panel.
FeaturePage.mainClassName = "feature";
