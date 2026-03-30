import React, { FC, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { DimensionInterface } from "shared/types/dimension";
import Link from "next/link";
import { ago } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import DimensionForm from "@/components/Dimensions/DimensionForm";
import { useDefinitions } from "@/services/DefinitionsContext";
import { envAllowsCreatingDimensions, hasFileConfig } from "@/services/env";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import { DocLink } from "@/components/DocLink";
import Code, { Language } from "@/components/SyntaxHighlighting/Code";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useSearch } from "@/services/search";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { EAQ_ANCHOR_ID } from "@/pages/datasources/[did]";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import { useUser } from "@/services/UserContext";

type ExperimentDimensionItem = {
  id: string;
  dimension: string;
  datasourceName: string;
  datasourceId: string;
  identifierTypes: string[];
};

function getExperimentDimensions(
  datasources: DataSourceInterfaceWithParams[],
): ExperimentDimensionItem[] {
  const collapsedExperimentDimensions: Record<string, ExperimentDimensionItem> =
    {};

  datasources.forEach((ds) => {
    ds.settings.queries?.exposure?.forEach((eq) => {
      eq.dimensions.forEach((d) => {
        const key = `${d}-${ds.id}`;
        if (!collapsedExperimentDimensions[key]) {
          collapsedExperimentDimensions[key] = {
            id: key,
            dimension: d,
            datasourceName: ds.name,
            datasourceId: ds.id,
            identifierTypes: [eq.userIdType],
          };
        } else if (
          !collapsedExperimentDimensions[key].identifierTypes.includes(
            eq.userIdType,
          )
        ) {
          collapsedExperimentDimensions[key].identifierTypes.push(
            eq.userIdType,
          );
        }
      });
    });
  });

  const experimentDimensions = Object.values(collapsedExperimentDimensions);
  return experimentDimensions;
}

const DimensionsPage: FC = () => {
  const {
    dimensions,
    datasources,
    getDatasourceById,
    ready,
    error,
    mutateDefinitions,
  } = useDefinitions();
  const { getOwnerDisplay } = useUser();

  const permissionsUtil = usePermissionsUtil();
  const hasCreateDimensionPermission = permissionsUtil.canCreateDimension();
  const hasEditDimensionPermission = permissionsUtil.canUpdateDimension();
  const hasDeleteDimensionPermissions = permissionsUtil.canDeleteDimension();
  const orgCanCreateDimensions = hasFileConfig()
    ? envAllowsCreatingDimensions()
    : true;

  const [dimensionForm, setDimensionForm] =
    useState<null | Partial<DimensionInterface>>(null);

  const { apiCall } = useAuth();

  const experimentDimensions = getExperimentDimensions(datasources);

  const {
    items,
    SortableTableColumnHeader: SortableTableColumnHeaderExperiment,
    pagination,
  } = useSearch({
    items: experimentDimensions,
    localStorageKey: "dimensions",
    defaultSortField: "dimension",
    defaultSortDir: 1,
    searchFields: [
      "dimension",
      "datasourceName",
      "datasourceId",
      "identifierTypes",
    ],
    pageSize: 10,
  });

  const {
    items: unitDimensionsItems,
    SortableTableColumnHeader: SortableTableColumnHeaderUnit,
    pagination: unitPagination,
  } = useSearch({
    items: dimensions,
    localStorageKey: "unitDimensions",
    defaultSortField: "name",
    defaultSortDir: 1,
    searchFields: ["name", "owner", "description", "sql"],
    pageSize: 20,
  });

  if (!error && !ready) {
    return <LoadingOverlay />;
  }

  const hasValidDataSources = !!datasources.filter(
    (d) => d.properties?.dimensions,
  )[0];

  if (!hasValidDataSources) {
    return (
      <Box className="container-fluid pagecontents" p="3">
        <Flex align="center" gap="2" mb="3">
          <h1 style={{ margin: 0 }}>User Dimensions</h1>
          <DocLink docSection="dimensions">View Documentation</DocLink>
        </Flex>
        <Callout status="info">
          Dimensions are only available if you connect GrowthBook to a
          compatible data source (Snowflake, Redshift, BigQuery, ClickHouse,
          Athena, Postgres, MySQL, MS SQL, Presto, Databricks, or Mixpanel).
          Support for other data sources like Google Analytics is coming soon.
        </Callout>
      </Box>
    );
  }

  if (error) {
    return (
      <Callout status="error">
        There was an error loading the list of dimensions
      </Callout>
    );
  }

  return (
    <Box className="container-fluid pagecontents" p="3">
      {dimensionForm && (
        <DimensionForm
          close={() => setDimensionForm(null)}
          current={dimensionForm}
        />
      )}
      <Flex mb="3" direction="column">
        <Box>
          <h1 style={{ margin: 0 }}>Experiment Dimensions</h1>
        </Box>
        <Box mb="3">
          <Text as="p" m="0">
            Experiment Dimensions are specific to the point-in-time that a unit
            is put into an experiment - for example, &quot;browser&quot; or
            &quot;referrer&quot;. They are defined via the experiment assignment
            queries and are the preferred way to specify dimensions.
          </Text>
        </Box>
        <Table
          variant="list"
          stickyHeader
          roundedCorners
          className="appbox responsive-table"
        >
          <TableHeader>
            <TableRow>
              <SortableTableColumnHeaderExperiment field="dimension">
                Name
              </SortableTableColumnHeaderExperiment>
              <SortableTableColumnHeaderExperiment field="datasourceName">
                Data Source
              </SortableTableColumnHeaderExperiment>
              <SortableTableColumnHeaderExperiment field="identifierTypes">
                Identifier Types
              </SortableTableColumnHeaderExperiment>
              <TableColumnHeader />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              return (
                <TableRow
                  key={`${item.dimension}-${item.datasourceId}`}
                  className="hover-highlight"
                >
                  <TableCell>{item.dimension}</TableCell>
                  <TableCell>
                    <Link href={`/datasources/${item.datasourceId}`}>
                      {item.datasourceName ?? item.datasourceId}
                    </Link>
                  </TableCell>
                  <TableCell
                    style={{ maxWidth: "20ch", wordWrap: "break-word" }}
                  >
                    {item.identifierTypes.join(", ")}
                  </TableCell>
                  <TableCell>
                    <MoreMenu useRadix={true}>
                      <Link
                        className="dropdown-item"
                        href={`/datasources/${item.datasourceId}#${EAQ_ANCHOR_ID}`}
                      >
                        Manage via Data Source
                      </Link>
                    </MoreMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {pagination}
      </Flex>
      <Flex align="center" justify="between" mb="3" wrap="wrap" gap="3">
        <h1 style={{ margin: 0 }}>Unit Dimensions</h1>
        {orgCanCreateDimensions && hasCreateDimensionPermission && (
          <Button
            onClick={() => {
              setDimensionForm({});
            }}
          >
            Add Unit Dimension
          </Button>
        )}
      </Flex>
      {dimensions.length > 0 && (
        <Box mb="4">
          <Text as="p" mb="3">
            Unit Dimensions are attributes of your units - for example,
            &quot;subscription plan&quot; or &quot;age group&quot;. GrowthBook
            will join these dimensions to your units in the exposure query to
            let you drill down into experiment results.
          </Text>
          <Table
            variant="list"
            stickyHeader
            roundedCorners
            className="appbox responsive-table"
          >
            <TableHeader>
              <TableRow>
                <SortableTableColumnHeaderUnit field="name">
                  Name
                </SortableTableColumnHeaderUnit>
                <SortableTableColumnHeaderUnit field="owner">
                  Owner
                </SortableTableColumnHeaderUnit>
                <TableColumnHeader className="d-none d-sm-table-cell">
                  Data Source
                </TableColumnHeader>
                <TableColumnHeader className="d-none d-md-table-cell">
                  Identifier Type
                </TableColumnHeader>
                <TableColumnHeader className="d-none d-lg-table-cell">
                  Definition
                </TableColumnHeader>
                <SortableTableColumnHeaderUnit field="dateUpdated">
                  Date Updated
                </SortableTableColumnHeaderUnit>
                <TableColumnHeader />
              </TableRow>
            </TableHeader>
            <TableBody>
              {unitDimensionsItems.map((s) => {
                const datasource = getDatasourceById(s.datasource);
                const language: Language =
                  datasource?.properties?.queryLanguage || "sql";
                return (
                  <TableRow key={s.id} className="hover-highlight">
                    <TableCell>
                      <>
                        <OfficialBadge
                          type="Dimension"
                          managedBy={s.managedBy}
                        />
                        {s.name}{" "}
                        {s.description ? (
                          <Tooltip body={s.description} />
                        ) : null}
                      </>
                    </TableCell>
                    <TableCell>{getOwnerDisplay(s.owner)}</TableCell>
                    <TableCell className="d-none d-sm-table-cell">
                      {datasource && (
                        <>
                          <Link href={`/datasources/${datasource.id}`}>
                            {datasource.name}
                          </Link>{" "}
                          {datasource.description ? (
                            <Tooltip body={datasource.description} />
                          ) : null}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="d-none d-md-table-cell">
                      {datasource?.properties?.userIds
                        ? s.userIdType || "user_id"
                        : ""}
                    </TableCell>
                    <TableCell
                      className="d-none d-lg-table-cell"
                      style={{ maxWidth: "30em" }}
                    >
                      <Code
                        language={language}
                        code={s.sql}
                        expandable={true}
                      />
                    </TableCell>
                    <TableCell>
                      {s.dateUpdated ? ago(s.dateUpdated) : <span>-</span>}
                    </TableCell>
                    {!s.managedBy ? (
                      <TableCell>
                        {hasEditDimensionPermission ? (
                          <a
                            href="#"
                            className="tr-hover text-primary mr-3"
                            title="Edit this dimension"
                            onClick={(e) => {
                              e.preventDefault();
                              setDimensionForm(s);
                            }}
                          >
                            <FaPencilAlt />
                          </a>
                        ) : null}
                        {hasDeleteDimensionPermissions ? (
                          <DeleteButton
                            link={true}
                            className="tr-hover text-primary"
                            displayName={s.name}
                            title="Delete this dimension"
                            onClick={async () => {
                              await apiCall(`/dimensions/${s.id}`, {
                                method: "DELETE",
                              });
                              await mutateDefinitions({});
                            }}
                          />
                        ) : null}
                      </TableCell>
                    ) : (
                      <TableCell />
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {unitPagination}
        </Box>
      )}
      {!error && dimensions.length === 0 && orgCanCreateDimensions && (
        <Callout status="info">
          You don&apos;t have any user dimensions defined yet.{" "}
          {hasCreateDimensionPermission &&
            "Click the button above to create your first one."}
        </Callout>
      )}
      {!error && dimensions.length === 0 && !orgCanCreateDimensions && (
        <Callout status="info">
          It looks like you have a <code>config.yml</code> file. Dimensions
          defined there will show up on this page.{" "}
          <DocLink docSection="config_yml">View Documentation</DocLink>
        </Callout>
      )}
    </Box>
  );
};

export default DimensionsPage;
