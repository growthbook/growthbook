import PageHead from "@/components/Layout/PageHead";

export async function getServerSideProps(context) {
  const { r } = context.params;

  const API_HOST = (process.env.API_HOST ?? "").replace(/\/$/, "") || "http://localhost:3100";
  const resp = await fetch(API_HOST + `/api/report/public/${r}`);
  const { report } = await resp.json();

  return {
    props: {
      r,
      report,
    },
  };
}

interface ReportPageProps {
  r: string;
  report: { title: string };
}

export default function ReportPage(props: ReportPageProps) {
  const { report } = props;

  return (
    <div className="pagecontents container-fluid">
      <PageHead
        breadcrumb={[
          {display: `Reports`, href: `/reports`},
          {display: report?.title ?? "(no title)"},
        ]}
      />

      <h1>{report.title}</h1>
      <pre>{JSON.stringify(report, null, 2)}</pre>
    </div>
  );
}

ReportPage.preAuth = true;
ReportPage.progressiveAuth = true;
ReportPage.progressiveAuthTopNav = true;
ReportPage.noLoadingOverlay = true;
