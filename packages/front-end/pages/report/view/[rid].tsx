import { FC } from "react";
import useApi from "../../../hooks/useApi";
import { useRouter } from "next/router";
import { ReportInterface, QueryResult } from "../../../types/reports";
import LoadingOverlay from "../../../components/LoadingOverlay";
import ResultsTable from "../../../components/Report/ResultsTable";
import Visualization from "../../../components/Report/Visualization";

const EditReportPage: FC = () => {
  const router = useRouter();
  const { rid } = router.query;

  const { data, error } = useApi<{
    report: ReportInterface;
    results: QueryResult[];
  }>(`/report/${rid}`);

  if (error) {
    return <div>There was a problem loading the report</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div className="container-fluid">
      <h1>{data.report.title}</h1>
      {data.report.description ? <p>{data.report.description}</p> : ""}
      <hr />
      {data.report.queries.map((query, i) => (
        <div className="my-3" key={i}>
          {query.visualizations.map((visualization, j) => (
            <div className="mb-3" key={j}>
              <Visualization
                visualization={visualization}
                data={data.results[i]}
              />
            </div>
          ))}
          <ResultsTable {...data.results[i]} />
        </div>
      ))}
    </div>
  );
};

export default EditReportPage;
