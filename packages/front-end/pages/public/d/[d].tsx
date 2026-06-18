import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { GetServerSidePropsContext } from "next";
import {
  DashboardInterface,
  DashboardSSRData,
  DashboardPublicBlockData,
  DashboardBlockInterface,
} from "shared/enterprise";
import { truncateString } from "shared/util";
import { useUser } from "@/services/UserContext";
import useSSRPolyfills from "@/hooks/useSSRPolyfills";
import { getApiHost } from "@/services/env";
import Callout from "@/ui/Callout";
import PageHead from "@/components/Layout/PageHead";
import { DashboardGrid } from "@/enterprise/components/Dashboards/DashboardEditor";
import PublicDashboardBlock from "@/enterprise/components/Dashboards/Public/PublicDashboardBlock";

// Only the lightweight shell (dashboard config + ssrData) is server-rendered.
// The heavy block result data is fetched client-side (see below) so it never
// bloats the page document.
export async function getServerSideProps(context: GetServerSidePropsContext) {
  const { d } = context.params as { d: string };
  const apiHost =
    (process.env.API_HOST ?? "").replace(/\/$/, "") || "http://localhost:3100";

  try {
    const resp = await fetch(apiHost + `/api/dashboard/public/${d}`);
    const data = await resp.json();
    const dashboard = data?.dashboard;
    if (!dashboard) {
      context.res.statusCode = 404;
    }

    return {
      props: {
        dashboard: dashboard || null,
        ssrData: data?.ssrData || null,
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
}

export default function PublicDashboardPage({
  dashboard,
  ssrData,
}: PublicDashboardPageProps) {
  const { userId, organization: userOrganization, superAdmin } = useUser();
  const ssrPolyfills = useSSRPolyfills(ssrData);

  // Org members get the in-app affordances; everyone else sees the public view.
  const isOrgMember =
    (!!userId && dashboard?.organization === userOrganization.id) ||
    !!superAdmin;

  // Block result data is heavy (snapshots, query result rows), so it's fetched
  // client-side from the public /blocks endpoint rather than serialized into the
  // page. Blocks show a loading state until it arrives.
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
        setBlockData(
          d?.blockData ?? {
            snapshots: [],
            savedQueries: [],
            metricAnalyses: [],
            explorations: [],
          },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setBlockData({
            snapshots: [],
            savedQueries: [],
            metricAnalyses: [],
            explorations: [],
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const blockDataLoading = !!dashboard && blockData === null;

  const savedQueriesMap = useMemo(
    () => new Map((blockData?.savedQueries ?? []).map((q) => [q.id, q])),
    [blockData?.savedQueries],
  );
  const snapshotsMap = useMemo(
    () => new Map((blockData?.snapshots ?? []).map((s) => [s.id, s])),
    [blockData?.snapshots],
  );

  return (
    <div className="pagecontents container-fluid pt-3">
      <Head>
        <title>
          {dashboard?.title
            ? `${dashboard.title} | GrowthBook`
            : "Dashboard not found | GrowthBook"}
        </title>
        <meta
          property="og:title"
          content={
            dashboard?.title
              ? `Dashboard: ${dashboard.title} | GrowthBook`
              : "Dashboard not found | GrowthBook"
          }
        />
        <meta
          property="og:description"
          content={truncateString(dashboard?.title || "", 500)}
        />
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

      {dashboard ? (
        <DashboardGrid
          blocks={dashboard.blocks}
          isEditing={false}
          editSidebarDirty={false}
          stagedBlockIndex={undefined}
          updateLayout={undefined}
          renderBlock={(block) => (
            <PublicDashboardBlock
              block={block as DashboardBlockInterface}
              ssrPolyfills={ssrPolyfills}
              savedQueriesMap={savedQueriesMap}
              snapshotsMap={snapshotsMap}
              blockDataLoading={blockDataLoading}
            />
          )}
        />
      ) : (
        <Callout status="error">This dashboard was not found.</Callout>
      )}
      {isOrgMember && dashboard ? (
        <div className="mt-3">
          <Callout status="info" size="sm">
            You&apos;re viewing the public version of this dashboard.
          </Callout>
        </div>
      ) : null}
    </div>
  );
}

PublicDashboardPage.preAuth = true;
PublicDashboardPage.progressiveAuth = true;
PublicDashboardPage.progressiveAuthTopNav = true;
PublicDashboardPage.noLoadingOverlay = true;
PublicDashboardPage.mainClassName = "public dashboard";
