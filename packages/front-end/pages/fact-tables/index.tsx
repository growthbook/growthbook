import { isProjectListValidForProject } from "shared/util";
import Link from "next/link";
import { useCallback, useState } from "react";
import { date } from "shared/dates";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { useRouter } from "next/router";
import { useDefinitions } from "@/services/DefinitionsContext";
import FactTableModal from "@/components/FactTables/FactTableModal";
import { GBAddCircle } from "@/components/Icons";
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
import AutoGenerateFactTableModal from "@/components/AutoGenerateFactTablesModal";

export default function FactTablesPage() {
  const {
    factTables,
    getDatasourceById,
    project,
    factMetrics,
    mutateDefinitions,
  } = useDefinitions();

  const router = useRouter();

  const permissionsUtil = usePermissionsUtil();

  const [aboutOpen, setAboutOpen] = useLocalStorage("aboutFactTables", true);

  const [createFactOpen, setCreateFactOpen] = useState(false);
  const [discoverFactOpen, setDiscoverFactOpen] = useState(false);

  const factMetricCounts: Record<string, number> = {};
  factMetrics.forEach((m) => {
    const key = m.numerator.factTableId;
    factMetricCounts[key] = factMetricCounts[key] || 0;
    factMetricCounts[key]++;

    if (m.metricType === "ratio" && m.denominator) {
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
    items: factTablesWithLabels,
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
      {discoverFactOpen && (
        <AutoGenerateFactTableModal
          source="fact-tables-index-page"
          setShowAutoGenerateFactTableModal={setDiscoverFactOpen}
          mutate={mutateDefinitions}
        />
      )}
      <PageHead breadcrumb={[{ display: "Fact Tables" }]} />
      <h1>
        Fact Tables
        <Tooltip body="This initial release of Fact Tables is an early preview of what's to come. Expect some rough edges and bugs.">
          <span className="badge badge-purple border ml-2">beta</span>
        </Tooltip>
      </h1>
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
            <div className="col-auto">
              <TagsFilter filter={tagsFilter} items={items} />
            </div>
            <div className="ml-auto"></div>
          </>
        )}
        <div className="col-auto">
          <Tooltip
            body={
              canCreate
                ? ""
                : `You don't have permission to create fact tables ${
                    project ? "in this project" : ""
                  }`
            }
          >
            <button
              className="btn btn-outline-info mr-2"
              onClick={(e) => {
                e.preventDefault();
                if (!canCreate) return;
                setDiscoverFactOpen(true);
              }}
              disabled={!canCreate}
            >
              <GBAddCircle /> <strong>Discover Fact Tables</strong>
            </button>
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                if (!canCreate) return;
                setCreateFactOpen(true);
              }}
              disabled={!canCreate}
            >
              <GBAddCircle /> Add Fact Table
            </button>
          </Tooltip>
        </div>
      </div>

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
    </div>
  );
}
