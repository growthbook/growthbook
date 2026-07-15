import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { GetServerSidePropsContext } from "next";
import {
  DashboardInterface,
  DashboardSSRData,
  DashboardPublicBlockData,
  DashboardBlockInterface,
} from "shared/enterprise";
import { stripMarkdown, truncateString } from "shared/util";
import { Box } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import useSSRPolyfills from "@/hooks/useSSRPolyfills";
import { getApiHost } from "@/services/env";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import PageHead from "@/components/Layout/PageHead";
import { DashboardGrid } from "@/enterprise/components/Dashboards/DashboardEditor";
import PublicDashboardBlock from "@/enterprise/components/Dashboards/Public/PublicDashboardBlock";
import { DashboardSnapshotContext } from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";

const EMPTY_BLOCK_DATA: DashboardPublicBlockData = {
  snapshots: [],
  savedQueries: [],
  metricAnalyses: [],
  explorations: [],
};

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const { d } = context.params as { d: string };
  const apiHost =
    (process.env.API_HOST ?? "").replace(/\/$/, "") || "http://localhost:3100";

  try {
    const resp = await fetch(apiHost + `/api/dashboard/public/${d}`);
    const data: {
      dashboard?: DashboardInterface;
      ssrData?: DashboardSSRData;
    } = await resp.json();
    const dashboard = data?.dashboard;
    if (!dashboard) {
      context.res.statusCode = 404;
    }

    const markdownText = (dashboard?.blocks ?? [])
      .filter((block) => block.type === "markdown")
      .map((block) => block.content)
      .join("\n\n");
    const strippedMarkdown = stripMarkdown(markdownText);
    const description = strippedMarkdown
      ? truncateString(strippedMarkdown, 200)
      : dashboard?.title || "";

    return {
      props: {
        dashboard: dashboard || null,
        ssrData: data?.ssrData || null,
        description,
      },
    };
  } catch (e) {
    console.error(e);
    return { notFound: true };
  }
}

interface PublicDashboardPageProps {
  dashboard: DashboardInterface | null;
  ssrData: DashboardSSRData | null;
  description: string;
}

export default function PublicDashboardPage({
  dashboard,
  ssrData,
  description,
}: PublicDashboardPageProps) {
  const { userId, organization: userOrganization, superAdmin } = useUser();
  const ssrPolyfills = useSSRPolyfills(ssrData);

  const isOrgMember =
    (!!userId && dashboard?.organization === userOrganization.id) ||
    !!superAdmin;

  const privateDashboardUrl = dashboard
    ? dashboard.experimentId
      ? `/experiment/${dashboard.experimentId}#dashboards/${dashboard.id}`
      : `/product-analytics/dashboards/${dashboard.id}`
    : "";

  const [blockData, setBlockData] = useState<DashboardPublicBlockData | null>(
    null,
  );
  const uid = dashboard?.uid;
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    setBlockData(null);
    fetch(`${getApiHost()}/api/dashboard/public/${uid}/blocks`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setBlockData(d?.blockData ?? EMPTY_BLOCK_DATA);
      })
      .catch(() => {
        if (!cancelled) {
          setBlockData(EMPTY_BLOCK_DATA);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const blockDataLoading = !!dashboard && blockData === null;

  const pageTitle = dashboard?.title
    ? `${dashboard.title} | GrowthBook`
    : "Dashboard not found | GrowthBook";
  const socialTitle = dashboard?.title
    ? `Dashboard: ${dashboard.title} | GrowthBook`
    : "Dashboard not found | GrowthBook";

  const savedQueriesMap = useMemo(
    () => new Map((blockData?.savedQueries ?? []).map((q) => [q.id, q])),
    [blockData?.savedQueries],
  );
  const snapshotsMap = useMemo(
    () => new Map((blockData?.snapshots ?? []).map((s) => [s.id, s])),
    [blockData?.snapshots],
  );
  const metricAnalysesMap = useMemo(
    () => new Map((blockData?.metricAnalyses ?? []).map((a) => [a.id, a])),
    [blockData?.metricAnalyses],
  );
  const explorationsMap = useMemo(
    () => new Map((blockData?.explorations ?? []).map((e) => [e.id, e])),
    [blockData?.explorations],
  );

  const dashboardSnapshotContextValue = useMemo(
    () => ({
      snapshotsMap,
      savedQueriesMap,
      metricAnalysesMap,
      loading: false,
      refreshStatus: "succeeded" as const,
      allQueries: [],
      mutateSnapshot: async () => {},
      mutateSnapshotsMap: async () => {},
      updateAllSnapshots: async () => {},
    }),
    [snapshotsMap, savedQueriesMap, metricAnalysesMap],
  );

  return (
    <div className="pagecontents container-fluid pt-3">
      <Head>
        <title>{pageTitle}</title>
        <meta property="og:type" content="website" />
        <meta property="og:title" content={socialTitle} />
        <meta property="og:description" content={description} />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={socialTitle} />
        <meta name="twitter:description" content={description} />
      </Head>

      <PageHead
        breadcrumb={[
          {
            display:
              dashboard?.title ??
              (dashboard ? "(no title)" : "(dashboard not found)"),
          },
        ]}
      />

      {isOrgMember && dashboard ? (
        <Box mb="3">
          <Callout status="info" size="sm">
            You&apos;re viewing the public version of this dashboard.{" "}
            <Link href={privateDashboardUrl}>
              Go to the editable version
            </Link>
            .
          </Callout>
        </Box>
      ) : null}

      {dashboard ? (
        <DashboardSnapshotContext.Provider
          value={dashboardSnapshotContextValue}
        >
          <DashboardGrid
            blocks={dashboard.blocks}
            isEditing={false}
            editSidebarDirty={false}
            stagedBlockIndex={undefined}
            updateLayout={undefined}
            renderBlock={(block) => (
              <PublicDashboardBlock
                block={block as DashboardBlockInterface}
                dashboardUid={dashboard.uid}
                dashboardGlobalControls={dashboard.globalControls}
                ssrPolyfills={ssrPolyfills}
                savedQueriesMap={savedQueriesMap}
                snapshotsMap={snapshotsMap}
                metricAnalysesMap={metricAnalysesMap}
                explorationsMap={explorationsMap}
                blockDataLoading={blockDataLoading}
              />
            )}
          />
        </DashboardSnapshotContext.Provider>
      ) : (
        <Callout status="error">This dashboard was not found.</Callout>
      )}
    </div>
  );
}

PublicDashboardPage.preAuth = true;
PublicDashboardPage.progressiveAuth = true;
PublicDashboardPage.progressiveAuthTopNav = true;
PublicDashboardPage.noLoadingOverlay = true;
PublicDashboardPage.mainClassName = "public dashboard";
