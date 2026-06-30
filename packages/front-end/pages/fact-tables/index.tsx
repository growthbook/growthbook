import { isProjectListValidForProject } from "shared/util";
import { useCallback, useMemo, useState } from "react";
import { date } from "shared/dates";
import { FaArrowRight } from "react-icons/fa";
import { useRouter } from "next/router";
import { Box, Flex, Separator } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
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
import LinkButton from "@/ui/LinkButton";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import {
  createInitialResources,
  getInitialDatasourceResources,
} from "@/services/initial-resources";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { GBInfo } from "@/components/Icons";
import { useUser } from "@/services/UserContext";
import Text from "@/ui/Text";

export default function FactTablesPage() {
  const {
    _factTablesIncludingArchived: factTables,
    getDatasourceById,
    project,
    projects,
    factMetrics,
    mutateDefinitions,
    datasources,
  } = useDefinitions();

  const router = useRouter();
  const { getOwnerDisplay } = useUser();

  const hasDatasource = datasources.some(
    (d) =>
      d.properties?.queryLanguage === "sql" &&
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
        const resources = getInitialDatasourceResources({
          datasource,
          attributeSchema: settings.attributeSchema,
        });
        if (resources.factTables.length > 0) {
          return {
            datasource,
            resources,
          };
        }
      }
    }

    return null;
  }, [factTables.length, datasources, project, settings.attributeSchema]);

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

  const canCreate = permissionsUtil.canViewCreateFactTableModal(
    project,
    projects,
  );

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
        ownerNameDisplay: getOwnerDisplay(table.owner),
        numMetrics: factMetricCounts[table.id] || 0,
        numFilters: table.filters.length,
        numAutoSlices,
        userIdTypes: sortedUserIdTypes,
      };
    },
    [getDatasourceById, getOwnerDisplay],
  );

  const tagsFilter = useTagsFilter("facttables");
  const filterResults = useCallback(
    (items: typeof factTablesWithLabels) => {
      items = filterByTags(items, tagsFilter.tags);
      return items;
    },
    [tagsFilter.tags],
  );

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTableColumnHeader,
    clear,
  } = useSearch({
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
    <Box className="pagecontents container-fluid">
      {createFactOpen && (
        <FactTableModal close={() => setCreateFactOpen(false)} />
      )}
      <PageHead breadcrumb={[{ display: "Fact Tables" }]} />
      <Heading as="h1" size="x-large" mb="4">
        Fact Tables
      </Heading>

      {!filteredFactTables.length ? (
        <Box className="appbox" p="5" style={{ textAlign: "center" }}>
          <h2>A SQL Foundation for your Metrics</h2>
          <p>
            Fact Tables are SQL queries that select a set of rows from your data
            warehouse.
          </p>
          <p>
            Metrics are then defined on top of Fact Tables by filtering and
            aggregating the data.
          </p>
          <div className="mt-3">
            {!hasDatasource ? (
              <>
                <p>
                  Before creating a fact table, you must connect a SQL data
                  source.
                </p>
                <LinkButton href="/datasources">Connect Data Source</LinkButton>
              </>
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

          <Separator size="4" mb="6" mt="9" />

          <Box mb="6">
            <Text>
              GrowthBook is very flexible and supports a wide variety of data
              schemas. Here are a few examples:
            </Text>
          </Box>

          <Flex gap="9" justify={"center"} wrap="wrap">
            <Box>
              <h3>Raw Event Stream Example</h3>
              <Flex gap="2" mt="5">
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
                  <ExampleMetric
                    name="Mobile Sign Ups"
                    info={{
                      Filters:
                        "event_name = 'sign_up'\nAND device_type = 'mobile'",
                      Aggregation: "COUNT(DISTINCT user_id)",
                    }}
                  />
                  <ExampleMetric
                    name="Downloads per User"
                    info={{
                      Filters: "event_name = 'download'",
                      Aggregation: "COUNT(*)",
                    }}
                  />
                  <ExampleMetric
                    name="Form Completion Rate"
                    info={{
                      Numerator: "event_name = 'form_completion'",
                      Denominator: "event_name = 'form_start'",
                      Aggregation: "COUNT(*) / COUNT(*)",
                    }}
                  />
                  <ExampleMetric
                    name="Pages per Session"
                    info={{
                      Numerator: "event_name = 'page_view'",
                      Denominator: "event_name = 'session_start'",
                      Aggregation: "COUNT(*) / COUNT(*)",
                    }}
                  />
                </Flex>
              </Flex>
            </Box>
            <Box className="d-none d-lg-block">
              <Separator orientation="vertical" size="4" />
            </Box>
            <Box>
              <h3>Modeled Table Example</h3>
              <Flex gap="2" mt="5">
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
                  <ExampleMetric
                    name="Conversion Rate"
                    info={{
                      Aggregation: "COUNT(DISTINCT user_id)",
                    }}
                  />
                  <ExampleMetric
                    name="Revenue per User"
                    info={{
                      Aggregation: "SUM(amount)",
                    }}
                  />
                  <ExampleMetric
                    name="Average Order Value"
                    info={{
                      Numerator: "SUM(amount)",
                      Denominator: "COUNT(*)",
                    }}
                  />
                  <ExampleMetric
                    name="Orders with 5+ Items"
                    info={{
                      Filters: "numItems >= 5",
                      Aggregation: "COUNT(*)",
                    }}
                  />
                </Flex>
              </Flex>
            </Box>
          </Flex>
        </Box>
      ) : (
        <Box>
          <Flex mb="2" align="center" gap="3" wrap="wrap">
            {filteredFactTables.length > 0 && (
              <>
                <Box style={{ minWidth: 120, flex: "1 1 200px" }}>
                  <Field
                    placeholder="Search..."
                    type="search"
                    {...searchInputProps}
                  />
                </Box>
                {hasArchivedFactTables && (
                  <Box className="text-muted">
                    <Switch
                      value={showArchived}
                      onChange={setShowArchived}
                      id="show-archived"
                      label="Show archived"
                    />
                  </Box>
                )}
                <Box>
                  <TagsFilter filter={tagsFilter} items={items} />
                </Box>
                <Box style={{ marginLeft: "auto" }} />
              </>
            )}
            <Box>
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
            </Box>
          </Flex>
          <Table variant="list" stickyHeader roundedCorners className="appbox">
            <TableHeader>
              <TableRow>
                <SortableTableColumnHeader field="name">
                  Name
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="datasourceName">
                  Data Source
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="tags">
                  Tags
                </SortableTableColumnHeader>
                <TableColumnHeader>Projects</TableColumnHeader>
                <SortableTableColumnHeader field="userIdTypes">
                  Identifier Types
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="numMetrics">
                  Metrics
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="numAutoSlices">
                  Auto Slices
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="numFilters">
                  Filters
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="ownerNameDisplay">
                  Owner
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="dateUpdated">
                  Last Updated
                </SortableTableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((f) => (
                <TableRow
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
                  <TableCell>
                    <Link href={`/fact-tables/${f.id}`}>{f.name}</Link>
                    <OfficialBadge
                      type="fact table"
                      managedBy={f.managedBy}
                      leftGap={true}
                    />
                  </TableCell>
                  <TableCell>{f.datasourceName}</TableCell>
                  <TableCell>
                    <SortedTags tags={f.tags} useFlex />
                  </TableCell>
                  <TableCell className="col-2">
                    {f.projects.length > 0 ? (
                      <ProjectBadges
                        resourceType="fact table"
                        projectIds={f.projects}
                      />
                    ) : (
                      <ProjectBadges resourceType="fact table" />
                    )}
                  </TableCell>
                  <TableCell>
                    {f.userIdTypes.map((t) => (
                      <span className="badge badge-secondary mr-1" key={t}>
                        {t}
                      </span>
                    ))}
                  </TableCell>
                  <TableCell>{f.numMetrics}</TableCell>
                  <TableCell>{f.numAutoSlices}</TableCell>
                  <TableCell>{f.numFilters}</TableCell>
                  <TableCell>{f.ownerNameDisplay}</TableCell>
                  <TableCell>
                    {f.dateUpdated ? date(f.dateUpdated) : null}
                  </TableCell>
                </TableRow>
              ))}

              {!items.length && isFiltered && (
                <TableRow>
                  <TableCell colSpan={10} style={{ textAlign: "center" }}>
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
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  );
}

function ExampleMetric({
  name,
  info,
}: {
  name: string;
  info: { [key: string]: string };
}) {
  return (
    <Tooltip
      flipTheme={false}
      body={
        <Flex direction="column" gap="3" style={{ textAlign: "left" }}>
          {Object.entries(info).map(([key, value]) => (
            <div key={key}>
              <div>
                <Text size="small" weight="medium" color="text-low">
                  {key}:
                </Text>
              </div>
              <InlineCode language="sql" code={value} />
            </div>
          ))}
        </Flex>
      }
    >
      <Box className="border p-2 bg-white">
        {name} <GBInfo />
      </Box>
    </Tooltip>
  );
}
