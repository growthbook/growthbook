import { useMemo } from "react";
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
import Callout from "@/ui/Callout";
import PageHead from "@/components/Layout/PageHead";
import { DashboardGrid } from "@/enterprise/components/Dashboards/DashboardEditor";
import PublicDashboardBlock from "@/enterprise/components/Dashboards/Public/PublicDashboardBlock";

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
        blockData: data?.blockData || null,
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
  blockData: DashboardPublicBlockData | null;
}

export default function PublicDashboardPage({
  dashboard,
  ssrData,
  blockData,
}: PublicDashboardPageProps) {
  const { userId, organization: userOrganization, superAdmin } = useUser();
  const ssrPolyfills = useSSRPolyfills(ssrData);

  // Org members get the in-app affordances; everyone else sees the public view.
  const isOrgMember =
    (!!userId && dashboard?.organization === userOrganization.id) ||
    !!superAdmin;

  const savedQueriesMap = useMemo(
    () => new Map((blockData?.savedQueries ?? []).map((q) => [q.id, q])),
    [blockData?.savedQueries],
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
