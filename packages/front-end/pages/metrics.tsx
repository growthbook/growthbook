import React, { useState } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
import MetricForm from "../components/Metrics/MetricForm";
import { FaPlus, FaRegCopy } from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { datetime, ago } from "../services/dates";
import { useRouter } from "next/router";
import Link from "next/link";
import { useDefinitions } from "../services/DefinitionsContext";
import { hasFileConfig } from "../services/env";
import { useSearch, useSort } from "../services/search";
import Tooltip from "../components/Tooltip";
import { GBAddCircle } from "../components/Icons";
import Toggle from "../components/Forms/Toggle";
import useApi from "../hooks/useApi";
import usePermissions from "../hooks/usePermissions";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "../components/Tags/TagsFilter";
import SortedTags from "../components/Tags/SortedTags";
import { getDocsLink, inferDocsLink } from "../services/docsMapping";

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

  const tagsFilter = useTagsFilter("metrics");

  const [showArchived, setShowArchived] = useState(false);

  const { list, searchInputProps, isFiltered } = useSearch(
    data?.metrics || [],
    ["name", "tags", "type"]
  );
  const hasArchivedMetrics = list.find((m) => m.status === "archived");
  const { sorted, SortableTH } = useSort(
    filterByTags(
      list.filter((m) => {
        if (!showArchived) {
          if (m.status !== "archived") {
            return m;
          }
        } else {
          return m;
        }
      }),
      tagsFilter
    ),
    "name",
    1,
    "metrics",
    {
      datasource: (a, b) => {
        const da = a.datasource
          ? getDatasourceById(a.datasource)?.name || "Unknown"
          : "Manual";
        const db = b.datasource
          ? getDatasourceById(b.datasource)?.name || "Unknown"
          : "Manual";
        return da.localeCompare(db);
      },
    }
  );

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const metrics = data.metrics;

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
        <div className="d-flex">
          <h1>Metrics</h1>
          <a
            className="align-self-center ml-2 pb-1"
            href={inferDocsLink()}
            target="_blank"
            rel="noreferrer"
          >
            View Documentation
          </a>
        </div>
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
            <a href={getDocsLink("config_yml")}>View Documentation</a>
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
                body=" Metrics define success and failure for your business. Create metrics
        here to use throughout the GrowthBook app."
              />
            </small>
          </h3>
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
              <span className="h4 pr-2 m-0 d-inline-block align-top">
                <GBAddCircle />
              </span>
              Add Metric
            </button>
          </div>
        )}
      </div>
      <div className="row mb-2 align-items-center">
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
        <div className="col-auto">
          <TagsFilter filter={tagsFilter} items={sorted} />
        </div>
      </div>
      <table className="table appbox gbtable table-hover">
        <thead>
          <tr>
            <SortableTH field="name">Name</SortableTH>
            <SortableTH field="type">Type</SortableTH>
            <th>Tags</th>
            <th>Owner</th>
            <SortableTH field="datasource" className="d-none d-lg-table-cell">
              Data Source
            </SortableTH>
            {!hasFileConfig() && (
              <SortableTH
                field="dateUpdated"
                className="d-none d-md-table-cell"
              >
                Last Updated
              </SortableTH>
            )}
            {showArchived && <th>status</th>}
            {permissions.createMetrics && !hasFileConfig() && <th></th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((metric) => (
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
                <SortedTags tags={Object.values(metric.tags)} />
              </td>
              <td>{metric.owner}</td>
              <td className="d-none d-lg-table-cell">
                {metric.datasource
                  ? getDatasourceById(metric.datasource)?.name || "Unknown"
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

          {!sorted.length && (isFiltered || tagsFilter.tags.length > 0) && (
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
