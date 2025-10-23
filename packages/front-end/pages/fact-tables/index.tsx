import { isProjectListValidForProject } from "shared/util";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { date } from "shared/dates";
import { FaArrowRight } from "react-icons/fa";
import { useRouter } from "next/router";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import FactTableModal from "@/components/FactTables/FactTableModal";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAddComputedFields, useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
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
import Switch from "@/ui/Switch";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import LinkButton from "@/ui/LinkButton";
import {
  createInitialResources,
  getInitialDatasourceResources,
} from "@/services/initial-resources";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { GBInfo } from "@/components/Icons";

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
      isProjectListValidForProject(d.projects, project),
  );

  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const { metricDefaults } = useOrganizationMetricDefaults();
  const [autoGenerateError, setAutoGenerateError] = useState<string | null>(
    null,
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
        isProjectListValidForProject(t.projects, project),
      )
    : factTables;

  const hasArchivedFactTables = factTables.some((t) => t.archived);

  const canCreate = permissionsUtil.canViewCreateFactTableModal(project);

  const factTablesWithLabels = useAddComputedFields(
    filteredFactTables,
    (table) => {
      const sortedUserIdTypes = [...table.userIdTypes];
      sortedUserIdTypes.sort();
      const numAutoSlices = table.columns.filter(
        (col) => col.isAutoSliceColumn && !col.deleted,
      ).length;
      return {
        ...table,
        datasourceName: getDatasourceById(table.datasource)?.name || "Unknown",
        numMetrics: factMetricCounts[table.id] || 0,
        numFilters: table.filters.length,
        numAutoSlices,
        userIdTypes: sortedUserIdTypes,
      };
    },
    [getDatasourceById],
  );

  const tagsFilter = useTagsFilter("facttables");
  const filterResults = useCallback(
    (items: typeof factTablesWithLabels) => {
      items = filterByTags(items, tagsFilter.tags);
      return items;
    },
    [tagsFilter.tags],
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
      <h1 className="mb-4">Fact Tables</h1>

      {!filteredFactTables.length ? (
        <div className="appbox p-5 text-center">
          <h2>A SQL Foundation for your Metrics</h2>
          <p>
            With Fact Tables, you can better organize your metrics, cut down on
            repetitive copy/pasting, and unlock massive{" "}
            <Tooltip
              body={
                <div style={{ textAlign: "left" }}>
                  <p>
                    <strong>Enterprise-Only</strong> GrowthBook calculates
                    multiple metrics in a single database query when they share
                    the same Fact Table.
                  </p>
                  <p>
                    For warehouses like BigQuery that charge based on data
                    scanned, this can drastically reduce the costs, especially
                    when an experiment has many metrics.
                  </p>
                </div>
              }
            >
              <span
                style={{
                  textDecoration: "underline",
                  textDecorationStyle: "dotted",
                }}
              >
                SQL cost savings <GBInfo />
              </span>
            </Tooltip>
          </p>
          <div className="mt-3">
            {!hasDatasource ? (
              <LinkButton href="/datasources">Connect Data Source</LinkButton>
            ) : initialFactTableData && canCreate ? (
              <div>
                <Button
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
                  Auto-Generate Fact Tables
                </Button>

                <div className="mt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCreateFactOpen(true)}
                  >
                    Add Fact Table Manually
                  </Button>
                </div>
              </div>
            ) : (
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
            )}
          </div>

          {autoGenerateError && (
            <Callout status="error" mb="3">
              {autoGenerateError}
            </Callout>
          )}

          <Separator size="4" mb="9" mt="9" />

          <Flex gap="9" justify={"center"} wrap="wrap">
            <Box>
              <h3>Raw Event Stream Example</h3>
              <Flex gap="2">
                <Flex direction="column" gap="1">
                  <div>Fact Table</div>
                  <Box className="border px-3 py-2 bg-white">
                    <InlineCode
                      language="sql"
                      code={`SELECT\n  timestamp,\n  user_id,\n  event_name,\n  device_type\nFROM\n  events`}
                    />
                  </Box>
                </Flex>
                <Box p="2" style={{ alignSelf: "center" }}>
                  <FaArrowRight />
                </Box>
                <Flex direction="column" gap="1">
                  <div>Metrics</div>
                  <Box className="border p-2 bg-white">Mobile Sign Ups</Box>
                  <Box className="border p-2 bg-white">Downloads per User</Box>
                  <Box className="border p-2 bg-white">
                    Form Completion Rate
                  </Box>
                  <Box className="border p-2 bg-white">Pages per Session</Box>
                </Flex>
              </Flex>
            </Box>
            <Box className="d-none d-lg-block">
              <Separator orientation="vertical" size="4" />
            </Box>
            <Box>
              <h3>Modeled Table Example</h3>
              <Flex gap="2">
                <Flex direction="column" gap="1">
                  <div>Fact Table</div>
                  <Box className="border px-3 py-2 bg-white">
                    <InlineCode
                      language="sql"
                      code={`SELECT\n  timestamp,\n  user_id,\n  amount,\n  numItems\nFROM\n  orders`}
                    />
                  </Box>
                </Flex>
                <Box p="2" style={{ alignSelf: "center" }}>
                  <FaArrowRight />
                </Box>
                <Flex direction="column" gap="1">
                  <div>Metrics</div>
                  <Box className="border p-2 bg-white">Conversion Rate</Box>
                  <Box className="border p-2 bg-white">Revenue per User</Box>
                  <Box className="border p-2 bg-white">Average Order Value</Box>
                  <Box className="border p-2 bg-white">
                    Orders with 5+ Items
                  </Box>
                </Flex>
              </Flex>
            </Box>
          </Flex>
        </div>
      ) : (
        <div>
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
                    <Switch
                      value={showArchived}
                      onChange={setShowArchived}
                      id="show-archived"
                      label="Show archived"
                    />
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
          <table className="table appbox gbtable table-hover">
            <thead>
              <tr>
                <SortableTH field="name">Name</SortableTH>
                <SortableTH field="datasourceName">Data Source</SortableTH>
                <SortableTH field="tags">Tags</SortableTH>
                <th>Projects</th>
                <SortableTH field="userIdTypes">Identifier Types</SortableTH>
                <SortableTH field="numMetrics">Metrics</SortableTH>
                <SortableTH field="numAutoSlices">Auto Slices</SortableTH>
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
                    // If clicking on a link or button, default to browser behavior
                    if (
                      e.target instanceof HTMLElement &&
                      e.target.closest("a, button")
                    ) {
                      return;
                    }

                    // If cmd/ctrl/shift+click, open in new tab
                    if (
                      e.metaKey ||
                      e.ctrlKey ||
                      e.shiftKey ||
                      e.button === 1
                    ) {
                      window.open(`/fact-tables/${f.id}`, "_blank");
                      return;
                    }

                    // Otherwise, navigate to the fact table
                    e.preventDefault();
                    router.push(`/fact-tables/${f.id}`);
                  }}
                  className="cursor-pointer"
                >
                  <td>
                    <Link href={`/fact-tables/${f.id}`}>{f.name}</Link>
                    <OfficialBadge
                      type="fact table"
                      managedBy={f.managedBy}
                      leftGap={true}
                    />
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
                      />
                    ) : (
                      <ProjectBadges resourceType="fact table" />
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
                  <td>{f.numAutoSlices}</td>
                  <td>{f.numFilters}</td>
                  <td>{f.owner}</td>
                  <td>{f.dateUpdated ? date(f.dateUpdated) : null}</td>
                </tr>
              ))}

              {!items.length && isFiltered && (
                <tr>
                  <td colSpan={10} align={"center"}>
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
        </div>
      )}
    </div>
  );
}
