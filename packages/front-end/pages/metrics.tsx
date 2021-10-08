import React, { useState, useContext } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
import MetricForm from "../components/Metrics/MetricForm";
import { FaPlus, FaSort, FaSortUp, FaSortDown } from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { datetime, ago } from "../services/dates";
import { UserContext } from "../components/ProtectedPage";
import { useRouter } from "next/router";
import Link from "next/link";
import { useDefinitions } from "../services/DefinitionsContext";
import { hasFileConfig } from "../services/env";
import { useSearch } from "../services/search";
import Tooltip from "../components/Tooltip";

const MetricsPage = (): React.ReactElement => {
  const [modalData, setModalData] = useState<{
    current: Partial<MetricInterface>;
    edit: boolean;
  } | null>(null);

  const {
    ready,
    metrics,
    error,
    mutateDefinitions,
    getDatasourceById,
  } = useDefinitions();
  const router = useRouter();

  const { permissions } = useContext(UserContext);

  const [metricSort, setMetricSort] = useState({
    field: "name",
    dir: 1,
  });
  const setSort = (field: string) => {
    if (metricSort.field === field) {
      // switch dir:
      setMetricSort({ ...metricSort, dir: metricSort.dir * -1 });
    } else {
      setMetricSort({ field, dir: 1 });
    }
  };
  const {
    list: filteredMetrics,
    searchInputProps,
    isFiltered,
  } = useSearch(metrics || [], ["name", "tags", "type"]);

  if (error) {
    return <div className="alert alert-danger">An error occurred</div>;
  }
  if (!ready) {
    return <LoadingOverlay />;
  }

  const closeModal = (refresh: boolean) => {
    if (refresh) {
      mutateDefinitions({});
    }
    setModalData(null);
  };

  if (!metrics.length) {
    return (
      <div className="container p-4">
        {modalData && (
          <MetricForm
            {...modalData}
            onClose={closeModal}
            source="blank-state"
          />
        )}
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
        {hasFileConfig() && (
          <div className="alert alert-info">
            It looks like you have a <code>config.yml</code> file. Metrics
            defined there will show up on this page.{" "}
            <a href="https://docs.growthbook.io/self-host/config#configyml">
              View Documentation
            </a>
          </div>
        )}
        {permissions.createMetrics && !hasFileConfig() && (
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

  // sort the metrics:
  const sortedMetrics = filteredMetrics.sort((a, b) => {
    const comp1 = a[metricSort.field];
    const comp2 = b[metricSort.field];
    if (typeof comp1 === "string") {
      return comp1.localeCompare(comp2) * metricSort.dir;
    }
    return comp1 - comp2;
  });

  return (
    <div className="container-fluid py-3 p-3 pagecontents">
      {modalData && (
        <MetricForm {...modalData} onClose={closeModal} source="metrics-list" />
      )}

      <div className="filters md-form row mb-3 align-items-center">
        <div className="col-auto">
          <h3>
            Your Metrics{" "}
            <small className="text-muted">
              <Tooltip
                text=" Metrics define success and failure for your business. Create metrics
        here to use throughout the GrowthBook app."
              />
            </small>
          </h3>
        </div>
        <div className="col-lg-3 col-md-4 col-6">
          <input
            type="search"
            className=" form-control"
            placeholder="Search"
            aria-controls="dtBasicExample"
            {...searchInputProps}
          />
        </div>
        <div style={{ flex: 1 }} />
        {permissions.createMetrics && !hasFileConfig() && (
          <div className="col-auto">
            <button
              className="btn btn-primary float-right"
              onClick={() =>
                setModalData({
                  current: {},
                  edit: false,
                })
              }
            >
              <FaPlus /> Add Metric
            </button>
          </div>
        )}
      </div>
      <table className="table appbox table-hover">
        <thead>
          <tr>
            <th>
              Name{" "}
              <a
                href="#"
                className={
                  metricSort.field === "name" ? "activesort" : "inactivesort"
                }
                onClick={(e) => {
                  e.preventDefault();
                  setSort("name");
                }}
              >
                {metricSort.field === "name" ? (
                  metricSort.dir < 0 ? (
                    <FaSortUp />
                  ) : (
                    <FaSortDown />
                  )
                ) : (
                  <FaSort />
                )}
              </a>
            </th>
            <th>
              Type{" "}
              <a
                href="#"
                className={
                  metricSort.field === "type" ? "activesort" : "inactivesort"
                }
                onClick={(e) => {
                  e.preventDefault();
                  setSort("type");
                }}
              >
                {metricSort.field === "type" ? (
                  metricSort.dir < 0 ? (
                    <FaSortUp />
                  ) : (
                    <FaSortDown />
                  )
                ) : (
                  <FaSort />
                )}
              </a>
            </th>
            <th>Tags</th>
            <th className="d-none d-lg-table-cell">
              Data Source{" "}
              <a
                href="#"
                className={
                  metricSort.field === "datasource"
                    ? "activesort"
                    : "inactivesort"
                }
                onClick={(e) => {
                  e.preventDefault();
                  setSort("datasource");
                }}
              >
                {metricSort.field === "datasource" ? (
                  metricSort.dir < 0 ? (
                    <FaSortUp />
                  ) : (
                    <FaSortDown />
                  )
                ) : (
                  <FaSort />
                )}
              </a>
            </th>
            {!hasFileConfig() && (
              <th className="d-none d-md-table-cell">
                Last Updated{" "}
                <a
                  href="#"
                  className={
                    metricSort.field === "dateUpdated"
                      ? "activesort"
                      : "inactivesort"
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    setSort("dateUpdated");
                  }}
                >
                  {metricSort.field === "dateUpdated" ? (
                    metricSort.dir < 0 ? (
                      <FaSortUp />
                    ) : (
                      <FaSortDown />
                    )
                  ) : (
                    <FaSort />
                  )}
                </a>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sortedMetrics.map((metric) => (
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

              <td className="nowrap">
                {Object.values(metric.tags).map((col) => (
                  <span className="tag badge badge-secondary mr-2" key={col}>
                    {col}
                  </span>
                ))}
              </td>
              <td className="d-none d-lg-table-cell">
                {metric.datasource
                  ? getDatasourceById(metric.datasource)?.name || ""
                  : "Manual"}
              </td>
              {!hasFileConfig() && (
                <td
                  title={datetime(metric.dateUpdated)}
                  className="d-none d-md-table-cell"
                >
                  {ago(metric.dateUpdated)}
                </td>
              )}
            </tr>
          ))}
          {!sortedMetrics.length && isFiltered && (
            <tr>
              <td colSpan={!hasFileConfig() ? 5 : 4} align={"center"}>
                No matching metrics
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default MetricsPage;
