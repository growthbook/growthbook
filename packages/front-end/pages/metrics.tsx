import React, { useState } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
import MetricForm from "../components/Metrics/MetricForm";
import {
  FaPlus,
  FaSort,
  FaSortUp,
  FaSortDown,
  FaRegCopy,
} from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { datetime, ago } from "../services/dates";
import { useRouter } from "next/router";
import Link from "next/link";
import { useDefinitions } from "../services/DefinitionsContext";
import { hasFileConfig } from "../services/env";
import { useSearch } from "../services/search";
import Tooltip from "../components/Tooltip";
import { GBAddCircle } from "../components/Icons";
import Toggle from "../components/Forms/Toggle";
import useApi from "../hooks/useApi";
import usePermissions from "../hooks/usePermissions";

const MetricsPage = (): React.ReactElement => {
  const [modalData, setModalData] = useState<{
    current: Partial<MetricInterface>;
    edit: boolean;
  } | null>(null);

  const { mutateDefinitions, getDatasourceById } = useDefinitions();
  const router = useRouter();

  const { data, error, mutate } = useApi<{ metrics: MetricInterface[] }>(
    `/metrics`
  );

  const permissions = usePermissions();

  const [metricSort, setMetricSort] = useState({
    field: "name",
    dir: 1,
  });
  const [showArchived, setShowArchived] = useState(false);

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
  } = useSearch(data?.metrics || [], ["name", "tags", "type"]);

  if (error) {
    return <div className="alert alert-danger">An error occurred: {error}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const metrics = data.metrics;

  const hasArchivedMetrics = filteredMetrics.find(
    (m) => m.status === "archived"
  );
  const showingFilteredMetrics = filteredMetrics.filter((m) => {
    if (!showArchived) {
      if (m.status !== "archived") {
        return m;
      }
    } else {
      return m;
    }
  });

  const closeModal = (refresh: boolean) => {
    if (refresh) {
      mutateDefinitions({});
      mutate();
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
  const sortedMetrics = showingFilteredMetrics.sort((a, b) => {
    const comp1 = a[metricSort.field];
    const comp2 = b[metricSort.field];
    if (typeof comp1 === "string") {
      return comp1.localeCompare(comp2) * metricSort.dir;
    }
    return (comp1 - comp2) * metricSort.dir;
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
        {hasArchivedMetrics && (
          <div className="col-auto text-muted">
            <Toggle
              value={showArchived}
              setValue={setShowArchived}
              id="show-archived"
              label="show archived"
            />
            Show archived
          </div>
        )}
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
              <span className="h4 pr-2 m-0 d-inline-block align-top">
                <GBAddCircle />
              </span>
              Add Metric
            </button>
          </div>
        )}
      </div>
      <table className="table appbox gbtable table-hover">
        <thead>
          <tr>
            <th>
              <span
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setSort("name");
                }}
              >
                Name{" "}
                <a
                  href="#"
                  className={
                    metricSort.field === "name" ? "activesort" : "inactivesort"
                  }
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
              </span>
            </th>
            <th>
              <span
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setSort("type");
                }}
              >
                Type{" "}
                <a
                  href="#"
                  className={
                    metricSort.field === "type" ? "activesort" : "inactivesort"
                  }
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
              </span>
            </th>
            <th>Tags</th>
            <th className="d-none d-lg-table-cell">
              <span
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setSort("datasource");
                }}
              >
                Data Source{" "}
                <a
                  href="#"
                  className={
                    metricSort.field === "datasource"
                      ? "activesort"
                      : "inactivesort"
                  }
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
              </span>
            </th>
            {!hasFileConfig() && (
              <th className="d-none d-md-table-cell">
                <span
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    setSort("dateUpdated");
                  }}
                >
                  Last Updated{" "}
                  <a
                    href="#"
                    className={
                      metricSort.field === "dateUpdated"
                        ? "activesort"
                        : "inactivesort"
                    }
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
                </span>
              </th>
            )}
            {showArchived && <th>status</th>}
            {permissions.createMetrics && !hasFileConfig() && <th></th>}
          </tr>
        </thead>
        <tbody>
          {sortedMetrics.map((metric) => (
            <tr
              key={metric.id}
              onClick={(e) => {
                e.preventDefault();
                router.push(`/metric/${metric.id}`);
              }}
              style={{ cursor: "pointer" }}
              className={metric.status === "archived" ? "text-muted" : ""}
            >
              <td>
                <Link href={`/metric/${metric.id}`}>
                  <a
                    className={`${
                      metric.status === "archived" ? "text-muted" : "text-dark"
                    } font-weight-bold`}
                  >
                    {metric.name}
                  </a>
                </Link>
              </td>
              <td>{metric.type}</td>

              <td className="nowrap">
                {Object.values(metric.tags).map((col) => (
                  <span className="tag badge badge-primary mr-2" key={col}>
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
              {showArchived && (
                <td className="text-muted">
                  {metric.status === "archived" ? "archived" : "active"}
                </td>
              )}
              {permissions.createMetrics && !hasFileConfig() && (
                <td>
                  <button
                    className="tr-hover btn btn-secondary btn-sm float-right"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setModalData({
                        current: {
                          ...metric,
                          name: metric.name + " (copy)",
                        },
                        edit: false,
                      });
                    }}
                  >
                    <FaRegCopy /> Duplicate
                  </button>
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
