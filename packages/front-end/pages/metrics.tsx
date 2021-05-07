import React, { useState, useContext } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
import MetricForm from "../components/Metrics/MetricForm";
import { FaPlus } from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { useMetrics } from "../services/MetricsContext";
import { datetime, ago } from "../services/dates";
import { UserContext } from "../components/ProtectedPage";
import { useRouter } from "next/router";
import Link from "next/link";
import useDatasources from "../hooks/useDatasources";

const MetricsPage = (): React.ReactElement => {
  const [modalData, setModalData] = useState<{
    current: Partial<MetricInterface>;
    edit: boolean;
  } | null>(null);

  const { ready, metrics, error, refresh: mutate } = useMetrics();
  const router = useRouter();

  const { permissions } = useContext(UserContext);

  const { getById } = useDatasources();

  if (error) {
    return <div className="alert alert-danger">An error occurred</div>;
  }
  if (!ready) {
    return <LoadingOverlay />;
  }

  const closeModal = (refresh: boolean) => {
    if (refresh) {
      mutate();
    }
    setModalData(null);
  };

  if (!metrics.length) {
    return (
      <div className="container p-4">
        {modalData && <MetricForm {...modalData} onClose={closeModal} />}
        <h1>Metrics</h1>
        <p>
          Metrics define success and failure for your business. Every business
          is unique, but below are some common metrics to draw inspiration from:
        </p>
        <ul>
          <li>
            <strong>Advertising/SEO</strong> - page views per user, time on
            site, bounce rate
          </li>
          <li>
            <strong>E-Commerce</strong> - add to cart, start checkout, complete
            checkout, revenue, refunds
          </li>
          <li>
            <strong>Subscription</strong> - start trial, start subscription,
            MRR, engagement, NPS, churn
          </li>
          <li>
            <strong>Marketplace</strong> - seller signups, buyer signups,
            transactions, revenue, engagement
          </li>
        </ul>
        {permissions.createMetrics && (
          <button
            className="btn btn-lg btn-success"
            onClick={(e) => {
              e.preventDefault();
              setModalData({
                current: {},
                edit: false,
              });
            }}
          >
            <FaPlus /> Add your first Metric
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="container-fluid py-3 p-3 pagecontents">
      {modalData && <MetricForm {...modalData} onClose={closeModal} />}
      <h3 className="mb-3">
        Your Metrics
        {permissions.createMetrics && (
          <button
            className="btn btn-sm btn-success ml-3"
            onClick={() =>
              setModalData({
                current: {},
                edit: false,
              })
            }
          >
            <FaPlus /> Add Metric
          </button>
        )}
      </h3>
      <p>
        Metrics define success and failure for your business. Create metrics
        here to use throughout the Growth Book app.
      </p>
      <table className="table appbox table-hover">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th className="d-none d-lg-table-cell">Data Source</th>
            <th className="d-none d-md-table-cell">Last Updated</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => (
            <tr
              key={metric.id}
              onClick={(e) => {
                e.preventDefault();
                router.push("/metric/[mid]", `/metric/${metric.id}`);
              }}
              style={{ cursor: "pointer" }}
            >
              <td>
                <Link href="/metric/[mid]" as={`/metric/${metric.id}`}>
                  <a className="text-dark">{metric.name}</a>
                </Link>
              </td>
              <td>{metric.type}</td>
              <td className="d-none d-lg-table-cell">
                {metric.datasource
                  ? getById(metric.datasource)?.name || ""
                  : "Manual"}
              </td>
              <td
                title={datetime(metric.dateUpdated)}
                className="d-none d-md-table-cell"
              >
                {ago(metric.dateUpdated)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default MetricsPage;
