import {
  ExperimentSnapshotReportInterface,
  ExperimentReportSSRData,
} from "back-end/types/report";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import Head from "next/head";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { truncateString } from "shared/util";
import { date } from "shared/dates";
import PageHead from "@/components/Layout/PageHead";
import ReportResults from "@/components/Report/ReportResults";
import ReportMetaInfo from "@/components/Report/ReportMetaInfo";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";
import useSSRPolyfills from "@/hooks/useSSRPolyfills";

export async function getServerSideProps(context) {
  const { r } = context.params;
  const apiHost =
    (process.env.API_HOST ?? "").replace(/\/$/, "") || "http://localhost:3100";

  try {
    const resp = await fetch(apiHost + `/api/report/public/${r}`);
    const data = await resp.json();
    const report = data?.report;
    if (!report) {
      context.res.statusCode = 404;
    }

    const snapshot = data?.snapshot;
    const experiment = data?.experiment;
    const ssrData = data?.ssrData;

    return {
      props: {
        report: report || null,
        snapshot: snapshot || null,
        experiment: experiment || null,
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

interface ReportPageProps {
  report: ExperimentSnapshotReportInterface | null;
  snapshot: ExperimentSnapshotInterface | null;
  experiment: Partial<ExperimentInterfaceStringDates> | null;
  ssrData: ExperimentReportSSRData | null;
}

export default function ReportPage(props: ReportPageProps) {
  const { userId, organization: userOrganization, superAdmin } = useUser();
  const { report, snapshot, experiment, ssrData } = props;

  const isOrgMember =
    (!!userId && report?.organization === userOrganization.id) || !!superAdmin;

  const ssrPolyfills = useSSRPolyfills(ssrData);

  const dimensionName = !snapshot?.dimension
    ? "None"
    : ssrPolyfills?.getDimensionById?.(snapshot.dimension)?.name ||
      (snapshot.dimension === "pre:date"
        ? "Date Cohorts (First Exposure)"
        : "") ||
      (snapshot.dimension === "pre:activation" ? "Activation status" : "") ||
      snapshot.dimension?.split(":")?.[1] ||
      "None";

  const dateRangeLabel = snapshot
    ? `${date(snapshot.settings.startDate)} — ${
        snapshot.settings.endDate ? date(snapshot.settings.endDate) : "now"
      }`
    : "";

  return (
    <div className="pagecontents container-fluid">
      <Head>
        <title>
          {report?.title
            ? `${report.title} | GrowthBook`
            : "Report not found | GrowthBook"}
        </title>
        <meta
          property="og:title"
          content={
            report?.title
              ? `Report: ${report.title} | GrowthBook`
              : "Report not found | GrowthBook"
          }
        />
        <meta
          property="og:description"
          content={truncateString(report?.description || "", 500)}
        />
        <meta property="twitter:label1" content="Dimension" />
        <meta property="twitter:data1" content={dimensionName} />
        <meta property="twitter:label2" content="Date Range" />
        <meta property="twitter:data2" content={dateRangeLabel} />
      </Head>

      <PageHead
        breadcrumb={[
          { display: `Reports`, href: `/reports` },
          {
            display:
              report?.title ?? (report ? "(no title)" : "(report not found)"),
          },
        ]}
      />

      {report ? (
        <>
          <ReportMetaInfo
            report={report}
            experiment={experiment ?? undefined}
            showPrivateLink={isOrgMember}
          />
          <ReportResults
            report={report}
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
            showDetails={isOrgMember}
            ssrPolyfills={ssrPolyfills}
          />
        </>
      ) : (
        <Callout status="error">This report was not found.</Callout>
      )}
    </div>
  );
}

ReportPage.preAuth = true;
ReportPage.progressiveAuth = true;
ReportPage.progressiveAuthTopNav = true;
ReportPage.noLoadingOverlay = true;
ReportPage.mainClassName = "public report";
