import PageHead from "@/components/Layout/PageHead";

export async function getServerSideProps(context) {
  const { r } = context.params as { r: string };

  // Example server-side data fetching
  const report = { title: "My Report" }; // Replace with actual logic

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

export default function ReportPage({ report }: ReportPageProps) {
  return (
    <>
      <PageHead
        breadcrumb={[
          { display: `Reports`, href: `/reports` },
          { display: report?.title ?? "foo" },
        ]}
      />

      {/* Page Content */}
      <div className="pagecontents container-fluid">
        <h1>Report</h1>
        <pre>{JSON.stringify(report, null, 2)}</pre>
      </div>
    </>
  );
}

ReportPage.preAuth = true;
ReportPage.preAuthTopNav = true;
ReportPage.noLoadingOverlay = true;
