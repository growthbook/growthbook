import React, { useCallback, useState } from "react";
import { FaPlus, FaRegCopy } from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { useRouter } from "next/router";
import Link from "next/link";
import SortedTags from "@/components/Tags/SortedTags";
import { GBAddCircle } from "@/components/Icons";
import ProjectBadges from "@/components/ProjectBadges";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "@/components/Tags/TagsFilter";
import { ago, datetime } from "@/services/dates";
import { useAddComputedFields, useSearch } from "@/services/search";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import MetricForm from "@/components/Metrics/MetricForm";
import usePermissions from "@/hooks/usePermissions";
import Toggle from "@/components/Forms/Toggle";
import useApi from "@/hooks/useApi";
import { DocLink } from "@/components/DocLink";
import { useUser } from "@/services/UserContext";
import { hasFileConfig } from "@/services/env";
import Tooltip from "@/components/Tooltip/Tooltip";
import { checkMetricProjectPermissions } from "@/services/metrics";

const MetricsPage = (): React.ReactElement => {
  const [modalData, setModalData] = useState<{
    current: Partial<MetricInterface>;
    edit: boolean;
    duplicate: boolean;
  } | null>(null);

  const { getDatasourceById, mutateDefinitions, project } = useDefinitions();
  const router = useRouter();

  const { data, error, mutate } = useApi<{ metrics: MetricInterface[] }>(
    `/metrics`
  );

  const { getUserDisplay } = useUser();

  const permissions = usePermissions();

  const tagsFilter = useTagsFilter("metrics");

  const [showArchived, setShowArchived] = useState(false);

  const metrics = useAddComputedFields(
    data?.metrics,
    (m) => ({
      datasourceName: m.datasource
        ? getDatasourceById(m.datasource)?.name || "Unknown"
        : "Manual",
      datasourceDescription: m.datasource
        ? getDatasourceById(m.datasource)?.description || undefined
        : undefined,
      ownerName: getUserDisplay(m.owner),
    }),
    [getDatasourceById]
  );
  const filteredMetrics = metrics.filter((m) => {
    if (!project) return true;
    if (!m?.projects?.length) return true;
    return m?.projects?.includes(project);
  });

  // Searching
  const filterResults = useCallback(
    (items: typeof filteredMetrics) => {
      if (!showArchived) {
        items = items.filter((m) => m.status !== "archived");
      }
      items = filterByTags(items, tagsFilter.tags);
      return items;
    },
    [showArchived, tagsFilter.tags]
  );
  const editMetricsPermissions: { [id: string]: boolean } = {};
  filteredMetrics.forEach((m) => {
    editMetricsPermissions[m.id] = checkMetricProjectPermissions(
      m,
      permissions
    );
  });
  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: filteredMetrics,
    defaultSortField: "name",
    localStorageKey: "metrics",
    searchFields: ["name^3", "datasourceName", "ownerName", "tags", "type"],
    filterResults,
  });

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

  const closeModal = () => {
    setModalData(null);
  };
  const onSuccess = () => {
    mutateDefinitions();
    mutate();
  };

  if (!filteredMetrics.length) {
    return (
      <div className="container p-4">
        {modalData && (
          <MetricForm
            {...modalData}
            onClose={closeModal}
            onSuccess={onSuccess}
            source="blank-state"
          />
        )}
        <div className="d-flex">
          <h1>Metrics</h1>
          <DocLink docSection="metrics" className="align-self-center ml-2 pb-1">
            View Documentation
          </DocLink>
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
            <DocLink docSection="config_yml">View Documentation</DocLink>
          </div>
        )}
        {permissions.check("createMetrics", project) && !hasFileConfig() && (
          <button
            className="btn btn-lg btn-success"
            onClick={(e) => {
              e.preventDefault();
              setModalData({
                current: {},
                edit: false,
                duplicate: false,
              });
            }}
          >
            <FaPlus /> Add your first Metric
          </button>
        )}
      </div>
    );
  }

  const hasArchivedMetrics = filteredMetrics.find(
    (m) => m.status === "archived"
  );

  return (
    <div className="container-fluid py-3 p-3 pagecontents">
      {modalData && (
        <MetricForm
          {...modalData}
          onClose={closeModal}
          onSuccess={onSuccess}
          source="metrics-list"
        />
      )}

      <div className="filters md-form row mb-3 align-items-center">
        <div className="col-auto d-flex">
          <h1>
            Your Metrics{" "}
            <Tooltip
              className="small"
              body="Metrics define success and failure for your business. Create metrics
      here to use throughout the GrowthBook app."
            />
          </h1>
          <DocLink docSection="metrics" className="align-self-center ml-2 pb-1">
            View Documentation
          </DocLink>
        </div>
        <div style={{ flex: 1 }} />
        {permissions.check("createMetrics", project) && !hasFileConfig() && (
          <div className="col-auto">
            <button
              className="btn btn-primary float-right"
              onClick={() =>
                setModalData({
                  current: {},
                  edit: false,
                  duplicate: false,
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
          <Field placeholder="Search..." type="search" {...searchInputProps} />
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
          <TagsFilter filter={tagsFilter} items={items} />
        </div>
      </div>
      <table className="table appbox gbtable table-hover">
        <thead>
          <tr>
            <SortableTH field="name" className="col-3">
              Name
            </SortableTH>
            <SortableTH field="type" className="col-1">
              Type
            </SortableTH>
            <th className="col-2">Tags</th>
            <th>Projects</th>
            <th className="col-1">Owner</th>
            <SortableTH
              field="datasourceName"
              className="d-none d-lg-table-cell col-auto"
            >
              Data Source
            </SortableTH>
            {!hasFileConfig() && (
              <SortableTH
                field="dateUpdated"
                className="d-none d-md-table-cell col-1"
              >
                Last Updated
              </SortableTH>
            )}
            {showArchived && <th>status</th>}
            {!hasFileConfig() && <th></th>}
          </tr>
        </thead>
        <tbody>
          {items.map((metric) => (
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
              <td className="col-2">
                {metric?.projects?.length > 0 ? (
                  <ProjectBadges
                    projectIds={metric.projects}
                    className="badge-ellipsis short align-middle"
                  />
                ) : (
                  <ProjectBadges className="badge-ellipsis short align-middle" />
                )}
              </td>
              <td>{metric.owner}</td>
              <td className="d-none d-lg-table-cell">
                {metric.datasourceName}
                {metric.datasourceDescription && (
                  <div
                    className="text-gray font-weight-normal small text-ellipsis"
                    style={{ maxWidth: 350 }}
                  >
                    {metric.datasourceDescription}
                  </div>
                )}
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
              {!hasFileConfig() && (
                <td>
                  {editMetricsPermissions[metric.id] && (
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
                          duplicate: true,
                        });
                      }}
                    >
                      <FaRegCopy /> Duplicate
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}

          {!items.length && (isFiltered || tagsFilter.tags.length > 0) && (
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
