import React, { useState } from "react";
import useApi from "../hooks/useApi";
import LoadingOverlay from "../components/LoadingOverlay";
import { ReportInterface } from "../types/reports";
import { useAuth } from "../services/auth";
import { useRouter } from "next/router";
import Link from "next/link";

interface ReportsApiResponse {
  reports: ReportInterface[];
}

const ReportsPage = (): React.ReactElement => {
  const { data, error } = useApi<ReportsApiResponse>("/reports");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const { apiCall } = useAuth();

  if (error) {
    return <div className="alert alert-danger">An error occurred</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const createReport = async () => {
    setLoading(true);
    const res = await apiCall<{ report: string }>(`/reports`, {
      method: "POST",
    });

    router.push("/report/edit/[rid]", `/report/edit/${res.report}`);
  };

  return (
    <div className="container-fluid py-3">
      {loading && <LoadingOverlay />}
      <h1 className="mb-3">Reports</h1>
      <button className="btn btn-success mb-3" onClick={createReport}>
        Create Report
      </button>
      <table className="table table-bordered">
        <thead>
          <tr>
            <th>Title</th>
            <th>Description</th>
            <th>Queries</th>
            <th>Visualizations</th>
            <th>Created At</th>
            <th>Updated At</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.reports.map((report) => (
            <tr key={report.id}>
              <td>{report.title}</td>
              <td>{report.description}</td>
              <td>{report.queries.length}</td>
              {/* Add up number of visualizations in every query */}
              <td>
                {report.queries
                  .map((q) => q.visualizations.length)
                  .reduce((a, x) => a + x)}
              </td>
              <td>{report.dateCreated}</td>
              <td>{report.dateUpdated}</td>
              <td>
                <Link
                  href="/report/edit/[rid]"
                  as={`/report/edit/${report.id}`}
                >
                  <a className="btn btn-primary mr-3">Edit</a>
                </Link>
                <Link
                  href="/report/view/[rid]"
                  as={`/report/view/${report.id}`}
                >
                  <a className="btn btn-outline-primary">View</a>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ReportsPage;
