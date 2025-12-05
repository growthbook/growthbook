import {
  ExperimentReportSSRData,
} from "back-end/types/report";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import Head from "next/head";
import {ExperimentInterfaceStringDates, ExperimentPhaseStringDates, LinkedFeatureInfo} from "back-end/types/experiment";
import { truncateString } from "shared/util";
import {date, daysBetween} from "shared/dates";
import React, {useEffect, useRef, useState} from "react";
import clsx from "clsx";
import {VisualChangesetInterface} from "shared/types/visual-changeset";
import {URLRedirectInterface} from "back-end/types/url-redirect";
import PageHead from "@/components/Layout/PageHead";
import { useUser } from "@/services/UserContext";
import useSSRPolyfills from "@/hooks/useSSRPolyfills";
import PublicExperimentMetaInfo from "@/components/Experiment/Public/PublicExperimentMetaInfo";
import {Tabs, TabsList, TabsTrigger} from "@/ui/Tabs";
import {useScrollPosition} from "@/hooks/useScrollPosition";
import {useLocalStorage} from "@/hooks/useLocalStorage";
import {ExperimentTab} from "@/components/Experiment/TabbedPage";
import PublicExperimentOverview from "@/components/Experiment/Public/PublicExperimentOverview";
import PublicExperimentResults from "@/components/Experiment/Public/PublicExperimentResults";
import BanditSummaryResultsTab from "@/components/Experiment/TabbedPage/BanditSummaryResultsTab";

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

    const snapshot = data?.snapshot;
    const visualChangesets = data?.visualChangesets;
    const urlRedirects = data?.urlRedirects;
    const linkedFeatures = data?.linkedFeatures;
    const ssrData = data?.ssrData;

    return {
      props: {
        experiment: experiment || null,
        snapshot: snapshot || null,
        visualChangesets: visualChangesets || null,
        urlRedirects: urlRedirects || null,
        linkedFeatures: linkedFeatures || null,
        ssrData: ssrData || null,
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
  visualChangesets: VisualChangesetInterface[] | null;
  urlRedirects: URLRedirectInterface[] | null;
  linkedFeatures: LinkedFeatureInfo[] | null;
  ssrData: ExperimentReportSSRData | null;
}

const TABS_HEADER_HEIGHT_PX = 55;

export default function PublicExperimentPage(props: PublicExperimentPageProps) {
  const { userId, organization: userOrganization, superAdmin} = useUser();
  const {
    experiment,
    snapshot,
    visualChangesets,
    urlRedirects,
    linkedFeatures,
    ssrData
  } = props;

  const isOrgMember =
    (!!userId && experiment?.organization === userOrganization.id) || !!superAdmin;

  const ssrPolyfills = useSSRPolyfills(ssrData);

  const [tab, setTab] = useLocalStorage<ExperimentTab>(
    `tabbedPageTab__public__${experiment?.id}`,
    "overview"
  );
  const tabsRef = useRef<HTMLDivElement>(null);
  const [headerPinned, setHeaderPinned] = useState(false);
  const { scrollY } = useScrollPosition();
  useEffect(() => {
    if (!tabsRef.current) return;
    const isHeaderSticky =
      tabsRef.current.getBoundingClientRect().top <= TABS_HEADER_HEIGHT_PX;
    setHeaderPinned(isHeaderSticky);
  }, [scrollY]);

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
    ? `${startDate} — ${
      endDate ? endDate : "now"
    }`
    : "";

  const analysis = snapshot?.analyses?.[0];
  const hasResults = !!analysis?.results?.[0];
  const shouldHideTabs = !experiment ||
    (experiment?.status === "draft" && !hasResults && phases.length === 1);

  const isBandit = experiment?.type === "multi-armed-bandit";

  return (
    <div className={`public pb-2 ${isBandit ? "bandit" : "experiment"}`}>
      <Head>
        <title>{experiment?.name ? `${experiment.name} | GrowthBook` : "Experiment not found | GrowthBook"}</title>
        <meta
          property="og:title"
          content={experiment?.name ? (`${isBandit ? "Bandit" : "Experiment"}: ${experiment?.name} | GrowthBook`) : "Experiment not found | GrowthBook"}
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
              experiment?.name ?? (experiment ? "(no title)" : "(experiment not found)"),
          },
        ]}
      />

      {experiment ? (
        <PublicExperimentMetaInfo
          experiment={experiment}
          showPrivateLink={isOrgMember}
        />
      ) : null}

      {shouldHideTabs ? null : (
        <div
          className={clsx("experiment-tabs d-print-none", {
            pinned: headerPinned,
          })}
        >
          <div className="container-fluid pagecontents position-relative">
            <div className="row header-tabs position-relative" ref={tabsRef}>
              <Tabs
                value={tab}
                onValueChange={(t: ExperimentTab) => setTab(t)}
                style={{ width: "100%" }}
              >
                <TabsList size="3" className="px-3">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="results">Results</TabsTrigger>
                  {isBandit ? (
                    <TabsTrigger value="explore">Explore</TabsTrigger>
                  ) : null}
                </TabsList>
              </Tabs>

              <div className="col-auto experiment-date-range pr-3">
                {startDate && (
                  <span>
                    {startDate} — {endDate}{" "}
                    <span className="text-muted">
                      ({daysBetween(startDate, endDate)} days)
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {experiment ? (
        <div className="mt-3 container-fluid pagecontents px-3">
          <div
            className={clsx(
              "pt-3",
              tab === "overview" ? "d-block" : "d-none d-print-block"
            )}
          >
            <PublicExperimentOverview
              experiment={experiment}
              visualChangesets={visualChangesets ?? []}
              urlRedirects={urlRedirects ?? []}
              linkedFeatures={linkedFeatures ?? []}
              ssrPolyfills={ssrPolyfills}
            />
          </div>

          {isBandit ? (
            <div
              className={
                isBandit && tab === "results" ? "d-block mt-4" : "d-none d-print-block"
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
              (!isBandit && tab === "results") || (isBandit && tab === "explore")
                ? "d-block pt-2"
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
              isTabActive={(!isBandit && tab === "results") || (isBandit && tab === "explore")}
            />
          </div>
        </div>
      ): null}

    </div>
  );
}

PublicExperimentPage.preAuth = true;
PublicExperimentPage.progressiveAuth = true;
PublicExperimentPage.progressiveAuthTopNav = true;
PublicExperimentPage.noLoadingOverlay = true;
PublicExperimentPage.mainClassName = "public experiment";
