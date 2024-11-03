import { isProjectListValidForProject } from "shared/util";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { date } from "shared/dates";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { useRouter } from "next/router";
import { useDefinitions } from "@/services/DefinitionsContext";
import FactTableModal from "@/components/FactTables/FactTableModal";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAddComputedFields, useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import PageHead from "@/components/Layout/PageHead";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "@/components/Tags/TagsFilter";
import SortedTags from "@/components/Tags/SortedTags";
import ProjectBadges from "@/components/ProjectBadges";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Toggle from "@/components/Forms/Toggle";
import Button from "@/components/Radix/Button";
import Callout from "@/components/Radix/Callout";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import LinkButton from "@/components/Radix/LinkButton";
import {
  createInitialResources,
  getInitialDatasourceResources,
} from "@/services/initial-resources";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";

export default function FactTablesPage() {
  const {
    _factTablesIncludingArchived: factTables,
    getDatasourceById,
    project,
    factMetrics,
    mutateDefinitions,
    datasources,
  } = useDefinitions();

  const router = useRouter();

  const { demoDataSourceId } = useDemoDataSourceProject();

  const hasDatasource = datasources.some(
    (d) =>
      d.properties?.queryLanguage === "sql" &&
      d.id !== demoDataSourceId &&
      isProjectListValidForProject(d.projects, project)
  );

  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const { metricDefaults } = useOrganizationMetricDefaults();
  const [autoGenerateError, setAutoGenerateError] = useState<string | null>(
    null
  );
  const initialFactTableData = useMemo(() => {
    if (factTables.length > 0) return null;

    for (const datasource of datasources) {
      if (isProjectListValidForProject(datasource.projects, project)) {
        const resources = getInitialDatasourceResources({ datasource });
        if (resources.factTables.length > 0) {
          return {
            datasource,
            resources,
          };
        }
      }
    }

    return null;
  }, [factTables.length, datasources, project]);

  const permissionsUtil = usePermissionsUtil();

  const [aboutOpen, setAboutOpen] = useLocalStorage("aboutFactTables", true);

  const [createFactOpen, setCreateFactOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const factMetricCounts: Record<string, number> = {};
  factMetrics.forEach((m) => {
    const key = m.numerator.factTableId;
    factMetricCounts[key] = factMetricCounts[key] || 0;
    factMetricCounts[key]++;

    if (
      m.metricType === "ratio" &&
      m.denominator &&
      m.denominator.factTableId !== key
    ) {
      const key = m.denominator.factTableId;
      factMetricCounts[key] = factMetricCounts[key] || 0;
      factMetricCounts[key]++;
    }
  });

  const filteredFactTables = project
    ? factTables.filter((t) =>
        isProjectListValidForProject(t.projects, project)
      )
    : factTables;

  const hasArchivedFactTables = factTables.some((t) => t.archived);

  const canCreate = permissionsUtil.canViewCreateFactTableModal(project);

  const factTablesWithLabels = useAddComputedFields(
    filteredFactTables,
    (table) => {
      const sortedUserIdTypes = [...table.userIdTypes];
      sortedUserIdTypes.sort();
      return {
        ...table,
        datasourceName: getDatasourceById(table.datasource)?.name || "Unknown",
        numMetrics: factMetricCounts[table.id] || 0,
        numFilters: table.filters.length,
        userIdTypes: sortedUserIdTypes,
      };
    },
    [getDatasourceById]
  );

  const tagsFilter = useTagsFilter("facttables");
  const filterResults = useCallback(
    (items: typeof factTablesWithLabels) => {
      items = filterByTags(items, tagsFilter.tags);
      return items;
    },
    [tagsFilter.tags]
  );

  const { items, searchInputProps, isFiltered, SortableTH, clear } = useSearch({
    items: showArchived
      ? factTablesWithLabels
      : factTablesWithLabels.filter((t) => !t.archived),
    defaultSortField: "name",
    localStorageKey: "factTables",
    searchFields: [
      "name^3",
      "tags",
      "datasourceName",
      "userIdTypes",
      "description",
    ],
    filterResults,
  });

  return (
    <div className="pagecontents container-fluid">
      {createFactOpen && (
        <FactTableModal close={() => setCreateFactOpen(false)} />
      )}
      <PageHead breadcrumb={[{ display: "Fact Tables" }]} />
      <h1>Fact Tables</h1>
      <div className="mb-3">
        <a
          className="font-weight-bold"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setAboutOpen(!aboutOpen);
          }}
        >
          About Fact Tables {aboutOpen ? <FaAngleDown /> : <FaAngleRight />}
        </a>
        {aboutOpen && (
          <div className="appbox bg-light px-3 pt-3 mb-5">
            <p>
              With Fact Tables, you can better organize your metrics, cut down
              on repetitive copy/pasting, and unlock massive SQL cost savings{" "}
              <Tooltip
                body={
                  <>
                    <p>
                      <strong>Enterprise-Only</strong> GrowthBook calculates
                      multiple metrics in a single database query when they
                      share the same Fact Table.
                    </p>
                    <p>
                      For warehouses like BigQuery that charge based on data
                      scanned, this can drastically reduce the costs, especially
                      when an experiment has many metrics.
                    </p>
                  </>
                }
              />
            </p>
            <p>
              Learn more about the various parts that make up Fact Tables with
              an example:
            </p>
            <table className="table w-auto gbtable appbox">
              <tbody>
                <tr>
                  <th>Fact Table SQL</th>
                  <td>
                    A base SQL definition for an event with relevant columns
                    selected
                  </td>
                  <td>
                    <InlineCode language="sql" code="SELECT * FROM orders" />
                  </td>
                </tr>
                <tr>
                  <th>Filters</th>
                  <td>
                    Reusable SQL snippets to filter rows in the Fact Table
                  </td>
                  <td>
                    <InlineCode language="sql" code="device_type = 'mobile'" />
                  </td>
                </tr>
                <tr>
                  <th>Metrics</th>
                  <td style={{ verticalAlign: "top" }}>
                    Used in experiments as Goals or Guardrails
                  </td>
                  <td>
                    <InlineCode
                      language="sql"
                      code={`SELECT SUM(revenue)\nFROM   [factTables.Orders]\nWHERE  [filters.Mobile]`}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="row mb-2 align-items-center">
        {filteredFactTables.length > 0 && (
          <>
            <div className="col-lg-3 col-md-4 col-6">
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </div>
            {hasArchivedFactTables && (
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
            <div className="ml-auto"></div>
          </>
        )}
        <div className="col-auto">
          {initialFactTableData && canCreate && (
            <Button
              variant="outline"
              mr="2"
              onClick={async () => {
                setAutoGenerateError(null);
                await createInitialResources({
                  ...initialFactTableData,
                  apiCall,
                  settings,
                  metricDefaults,
                });
                await mutateDefinitions();
              }}
              setError={(error) => {
                setAutoGenerateError(error);
              }}
            >
              Auto-generate Fact Tables
            </Button>
          )}
          {hasDatasource ? (
            <Tooltip
              body={
                !canCreate
                  ? `You don't have permission to create fact tables ${
                      project ? "in this project" : ""
                    }`
                  : ""
              }
            >
              <Button
                onClick={() => {
                  if (!canCreate) return;
                  setCreateFactOpen(true);
                }}
                disabled={!canCreate}
              >
                Add Fact Table
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {autoGenerateError && (
        <Callout status="error" mb="3">
          {autoGenerateError}
        </Callout>
      )}

      {filteredFactTables.length > 0 && (
        <>
          <table className="table appbox gbtable table-hover">
            <thead>
              <tr>
                <SortableTH field="name">Name</SortableTH>
                <SortableTH field="datasourceName">Data Source</SortableTH>
                <SortableTH field="tags">Tags</SortableTH>
                <th>Projects</th>
                <SortableTH field="userIdTypes">Identifier Types</SortableTH>
                <SortableTH field="numMetrics">Metrics</SortableTH>
                <SortableTH field="numFilters">Filters</SortableTH>
                <SortableTH field="owner">Owner</SortableTH>
                <SortableTH field="dateUpdated">Last Updated</SortableTH>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <tr
                  key={f.id}
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(`/fact-tables/${f.id}`);
                  }}
                  className="cursor-pointer"
                >
                  <td>
                    <Link href={`/fact-tables/${f.id}`}>{f.name}</Link>
                    <OfficialBadge type="fact table" managedBy={f.managedBy} />
                  </td>
                  <td>{f.datasourceName}</td>
                  <td>
                    <SortedTags tags={f.tags} />
                  </td>
                  <td className="col-2">
                    {f.projects.length > 0 ? (
                      <ProjectBadges
                        resourceType="fact table"
                        projectIds={f.projects}
                        className="badge-ellipsis short align-middle"
                      />
                    ) : (
                      <ProjectBadges
                        resourceType="fact table"
                        className="badge-ellipsis short align-middle"
                      />
                    )}
                  </td>
                  <td>
                    {f.userIdTypes.map((t) => (
                      <span className="badge badge-secondary mr-1" key={t}>
                        {t}
                      </span>
                    ))}
                  </td>
                  <td>{f.numMetrics}</td>
                  <td>{f.numFilters}</td>
                  <td>{f.owner}</td>
                  <td>{f.dateUpdated ? date(f.dateUpdated) : null}</td>
                </tr>
              ))}

              {!items.length && isFiltered && (
                <tr>
                  <td colSpan={6} align={"center"}>
                    No matching fact tables.{" "}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        clear();
                      }}
                    >
                      Clear search field
                    </a>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
      {!hasDatasource && (
        <>
          <Callout status="info">
            You must first connect GrowthBook to a SQL data source before you
            can create Fact Tables.
          </Callout>

          <div className="mt-3">
            <LinkButton href="/datasources">Connect Data Source</LinkButton>
          </div>
        </>
      )}
    </div>
  );
}
