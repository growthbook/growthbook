import { hasSuperAdminPermission } from "shared/permissions";
import { ExperimentReportSSRData } from "shared/types/report";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import Head from "next/head";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "shared/types/experiment";
import { truncateString } from "shared/util";
import { date } from "shared/dates";
import React, { useState } from "react";
import clsx from "clsx";
import { Box, Flex } from "@radix-ui/themes";
import PageHead from "@/components/Layout/PageHead";
import { useUser } from "@/services/UserContext";
import useSSRPolyfills from "@/hooks/useSSRPolyfills";
import useMediaQuery from "@/hooks/useMediaQuery";
import PublicExperimentMetaInfo from "@/components/Experiment/Public/PublicExperimentMetaInfo";
import PublicExperimentDetails from "@/components/Experiment/Public/PublicExperimentDetails";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { ExperimentTab } from "@/components/Experiment/TabbedPage";
import PublicExperimentOverview from "@/components/Experiment/Public/PublicExperimentOverview";
import PublicExperimentResults from "@/components/Experiment/Public/PublicExperimentResults";
import BanditSummaryResultsTab from "@/components/Experiment/TabbedPage/BanditSummaryResultsTab";
import CollapsiblePanelLayout, {
  DetailsPanelToggle,
  PANEL_WIDTH_PX,
} from "@/components/CollapsiblePanelLayout";
import usePinnedHeader from "@/hooks/usePinnedHeader";
import {
  NARROW_LAYOUT_BREAKPOINT_PX,
  TABS_BAR_HEIGHT_PX,
  TABS_HEADER_HEIGHT_PX,
} from "@/components/Layout/constants";

export async function getServerSideProps(context) {
  const { e } = context.params;
  const apiHost =
    (process.env.API_HOST ?? "").replace(/\/$/, "") || "http://localhost:3100";

  try {
    const resp = await fetch(apiHost + `/api/experiment/public/${e}`);
    const data = await resp.json();
    const experiment = data?.experiment;
    if (!experiment) {
      context.res.statusCode = 404;
    }

    return {
      props: {
        experiment: experiment || null,
        snapshot: data?.snapshot || null,
        linkedFeatureCount: data?.linkedFeatureCount ?? 0,
        visualChangesetCount: data?.visualChangesetCount ?? 0,
        urlRedirectCount: data?.urlRedirectCount ?? 0,
        ssrData: data?.ssrData || null,
      },
    };
  } catch (e) {
    console.error(e);
    return {
      notFound: true,
    };
  }
}

interface PublicExperimentPageProps {
  experiment: ExperimentInterfaceStringDates | null;
  snapshot: ExperimentSnapshotInterface | null;
  linkedFeatureCount: number;
  visualChangesetCount: number;
  urlRedirectCount: number;
  ssrData: ExperimentReportSSRData | null;
}

export default function PublicExperimentPage(props: PublicExperimentPageProps) {
  const { userId, organization: userOrganization, superAdmin } = useUser();
  const {
    experiment,
    snapshot,
    linkedFeatureCount,
    visualChangesetCount,
    urlRedirectCount,
    ssrData,
  } = props;

  const isOrgMember =
    (!!userId && experiment?.organization === userOrganization.id) ||
    hasSuperAdminPermission(superAdmin, "impersonate");

  const ssrPolyfills = useSSRPolyfills(ssrData);

  const [tab, setTab] = useLocalStorage<ExperimentTab>(
    `tabbedPageTab__public__${experiment?.id}`,
    "overview",
  );

  // Open beside the overview when there's room for it; narrow, only on request.
  const narrow = useMediaQuery(`(max-width: ${NARROW_LAYOUT_BREAKPOINT_PX}px)`);
  const [detailsOpen, setDetailsOpen] = useState<boolean | null>(null);
  const detailsShown = detailsOpen ?? !narrow;
  const [detailsWidth, setDetailsWidth] = useState(PANEL_WIDTH_PX);

  const phases = experiment?.phases || [];
  const lastPhaseIndex = phases.length - 1;
  const lastPhase = phases[lastPhaseIndex] as
    | undefined
    | ExperimentPhaseStringDates;
  const startDate = phases?.[0]?.dateStarted
    ? date(phases[0].dateStarted, "UTC")
    : null;
  const endDate =
    phases.length > 0
      ? lastPhase?.dateEnded
        ? date(lastPhase.dateEnded, "UTC")
        : "now"
      : date(new Date());
  const dateRangeLabel = startDate
    ? `${startDate} — ${endDate ? endDate : "now"}`
    : "";

  const analysis = snapshot?.analyses?.[0];
  const hasResults = !!analysis?.results?.[0];
  const shouldHideTabs =
    !experiment ||
    (experiment?.status === "draft" && !hasResults && phases.length === 1);

  const [tabsPinSentinelRef, headerPinned] = usePinnedHeader(!!experiment);

  const isBandit = experiment?.type === "multi-armed-bandit";
  const onOverview = shouldHideTabs || tab === "overview";

  return (
    <div className={`public pb-2 ${isBandit ? "bandit" : "experiment"}`}>
      <Head>
        <title>
          {experiment?.name
            ? `${experiment.name} | GrowthBook`
            : "Experiment not found | GrowthBook"}
        </title>
        <meta
          property="og:title"
          content={
            experiment?.name
              ? `${isBandit ? "Bandit" : "Experiment"}: ${experiment?.name} | GrowthBook`
              : "Experiment not found | GrowthBook"
          }
        />
        <meta
          property="og:description"
          content={truncateString(experiment?.description || "", 500)}
        />
        <meta property="twitter:label1" content="Status" />
        <meta property="twitter:data1" content={experiment?.status} />
        <meta property="twitter:label2" content="Date Range" />
        <meta property="twitter:data2" content={dateRangeLabel} />
      </Head>

      <PageHead
        breadcrumb={[
          {
            display: isBandit ? "Bandits" : "Experiments",
            href: isBandit ? "/bandits" : "/experiments",
          },
          {
            display:
              experiment?.name ??
              (experiment ? "(no title)" : "(experiment not found)"),
          },
        ]}
      />

      {experiment ? (
        <PublicExperimentMetaInfo
          experiment={experiment}
          showPrivateLink={isOrgMember}
        />
      ) : null}

      {!experiment ? null : (
        <>
          <div
            ref={tabsPinSentinelRef}
            aria-hidden
            className="d-print-none"
            style={{
              height: 1,
              width: "100%",
              pointerEvents: "none",
            }}
          />
          <div
            className={clsx("experiment-tabs d-print-none", {
              pinned: headerPinned,
            })}
          >
            <div className="position-relative container-fluid pagecontents px-4">
              <div className="d-flex align-items-center header-tabs">
                {/* Kept without tabs: the details toggle lives here. */}
                <Tabs
                  value={tab}
                  onValueChange={(t: ExperimentTab) => setTab(t)}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  {shouldHideTabs ? null : (
                    <TabsList size="lg">
                      <Flex align="center" className="flex-1">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="results">Results</TabsTrigger>
                        {isBandit ? (
                          <TabsTrigger value="explore">Explore</TabsTrigger>
                        ) : null}
                      </Flex>
                    </TabsList>
                  )}
                </Tabs>
                {onOverview ? (
                  <DetailsPanelToggle
                    open={detailsShown}
                    setOpen={(open) => {
                      setDetailsWidth(PANEL_WIDTH_PX);
                      setDetailsOpen(open);
                    }}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </>
      )}

      {experiment ? (
        <Box
          mx="auto"
          width="100%"
          style={{ maxWidth: "var(--page-content-max-width)" }}
        >
          <CollapsiblePanelLayout
            open={onOverview && detailsShown}
            top={TABS_HEADER_HEIGHT_PX + TABS_BAR_HEIGHT_PX}
            width={detailsWidth}
            onWidthChange={setDetailsWidth}
            onCollapse={() => setDetailsOpen(false)}
            panel={
              <PublicExperimentDetails
                experiment={experiment}
                linkedFeatureCount={linkedFeatureCount}
                visualChangesetCount={visualChangesetCount}
                urlRedirectCount={urlRedirectCount}
              />
            }
          >
            <div className="container-fluid pagecontents px-4">
              <div
                className={clsx(
                  "pt-2",
                  onOverview ? "d-block" : "d-none d-print-block",
                )}
              >
                <PublicExperimentOverview
                  experiment={experiment}
                  ssrPolyfills={ssrPolyfills}
                />
              </div>

              {isBandit ? (
                <div
                  className={
                    tab === "results" ? "d-block py-4" : "d-none d-print-block"
                  }
                >
                  <BanditSummaryResultsTab
                    experiment={experiment}
                    isTabActive={tab === "results"}
                    ssrSnapshot={snapshot ?? undefined}
                    ssrPolyfills={ssrPolyfills}
                    isPublic={true}
                  />
                </div>
              ) : null}

              <div
                className={
                  (!isBandit && tab === "results") ||
                  (isBandit && tab === "explore")
                    ? "d-block py-4"
                    : "d-none d-print-block"
                }
              >
                <PublicExperimentResults
                  experiment={experiment}
                  snapshot={snapshot ?? undefined}
                  snapshotError={
                    !snapshot
                      ? new Error("Missing snapshot")
                      : snapshot.error
                        ? new Error(snapshot.error)
                        : snapshot?.status === "error"
                          ? new Error("Report analysis failed")
                          : undefined
                  }
                  ssrPolyfills={ssrPolyfills}
                  isTabActive={
                    (!isBandit && tab === "results") ||
                    (isBandit && tab === "explore")
                  }
                />
              </div>
            </div>
          </CollapsiblePanelLayout>
        </Box>
      ) : null}
    </div>
  );
}

PublicExperimentPage.preAuth = true;
PublicExperimentPage.progressiveAuth = true;
PublicExperimentPage.progressiveAuthTopNav = true;
PublicExperimentPage.noLoadingOverlay = true;
PublicExperimentPage.mainClassName = "public experiment";
