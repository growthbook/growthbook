import { useRouter } from "next/router";
import { ReportInterface } from "back-end/types/report";
import LoadingOverlay from "../../components/LoadingOverlay";
import Markdown from "../../components/Markdown/Markdown";
import useApi from "../../hooks/useApi";

export default function ReportPage() {
  const router = useRouter();
  const { rid } = router.query;

  const { data, error } = useApi<{ report: ReportInterface }>(`/report/${rid}`);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const report = data.report;

  return (
    <div className="container-fluid pagecontents">
      <h1>{report.title}</h1>
      {report.description && (
        <div className="mb-3">
          <Markdown>{report.description}</Markdown>
        </div>
      )}
    </div>
  );
}
