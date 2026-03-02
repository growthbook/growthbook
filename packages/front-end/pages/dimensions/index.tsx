import React, { FC, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { DimensionInterface } from "shared/types/dimension";
import clsx from "clsx";
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
import Table, { TableBody, TableCell, TableHeader, TableRow } from "@/ui/Table";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { EAQ_ANCHOR_ID } from "@/pages/datasources/[did]";
import { OfficialBadge } from "@/components/Metrics/MetricName";

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

  const { items, SortableTH, pagination } = useSearch({
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

  if (!error && !ready) {
    return <LoadingOverlay />;
  }

  const hasValidDataSources = !!datasources.filter(
    (d) => d.properties?.dimensions,
  )[0];

  if (!hasValidDataSources) {
    return (
      <div className="p-3 container-fluid pagecontents">
        <div className="row mb-3">
          <div className="col d-flex">
            <h1>User Dimensions</h1>
            <DocLink
              docSection="dimensions"
              className="align-self-center ml-2 pb-1"
            >
              View Documentation
            </DocLink>
          </div>
        </div>
        <div className="alert alert-info">
          Dimensions are only available if you connect GrowthBook to a
          compatible data source (Snowflake, Redshift, BigQuery, ClickHouse,
          Athena, Postgres, MySQL, MS SQL, Presto, Databricks, or Mixpanel).
          Support for other data sources like Google Analytics is coming soon.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-danger">
        There was an error loading the list of dimensions
      </div>
    );
  }

  return (
    <div className="p-3 container-fluid pagecontents">
      {dimensionForm && (
        <DimensionForm
          close={() => setDimensionForm(null)}
          current={dimensionForm}
        />
      )}
      <Flex mb="3" direction="column">
        <Box>
          <h1>Experiment Dimensions</h1>
        </Box>
        <Box mb="3">
          Experiment Dimensions are specific to the point-in-time that a unit is
          put into an experiment - for example, &quot;browser&quot; or
          &quot;referrer&quot;. They are defined via the experiment assignment
          queries and are the preferred way to specify dimensions.
        </Box>
        <Table className="appbox table gbtable responsive-table">
          <TableHeader>
            <TableRow>
              <SortableTH field="dimension">Name</SortableTH>
              <SortableTH field="datasourceName">Data Source</SortableTH>
              <SortableTH field="identifierTypes">Identifier Types</SortableTH>
              <th></th>
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
      <div className="row mb-3">
        <div className="col-auto d-flex">
          <h1>Unit Dimensions</h1>
        </div>
        <div style={{ flex: 1 }}></div>
        {orgCanCreateDimensions && hasCreateDimensionPermission && (
          <div className="col-auto">
            <Button
              onClick={async () => {
                setDimensionForm({});
              }}
            >
              Add Unit Dimension
            </Button>
          </div>
        )}
      </div>
      {dimensions.length > 0 && (
        <div className="row mb-4">
          <div className="col-12">
            <p>
              Unit Dimensions are attributes of your units - for example,
              &quot;subscription plan&quot; or &quot;age group&quot;. GrowthBook
              will join these dimensions to your units in the exposure query to
              let you drill down into experiment results.
            </p>
            <table
              className={clsx("table appbox gbtable", {
                "table-hover": !hasFileConfig(),
              })}
            >
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Owner</th>
                  <th className="d-none d-sm-table-cell">Data Source</th>
                  <th className="d-none d-md-table-cell">Identifier Type</th>
                  <th className="d-none d-lg-table-cell">Definition</th>
                  <th>Date Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {dimensions.map((s) => {
                  const datasource = getDatasourceById(s.datasource);
                  const language: Language =
                    datasource?.properties?.queryLanguage || "sql";
                  return (
                    <tr key={s.id}>
                      <td>
                        {" "}
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
                      </td>
                      <td>{s.owner}</td>
                      <td className="d-none d-sm-table-cell">
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
                      </td>
                      <td className="d-none d-md-table-cell">
                        {datasource?.properties?.userIds
                          ? s.userIdType || "user_id"
                          : ""}
                      </td>
                      <td
                        className="d-none d-lg-table-cell"
                        style={{ maxWidth: "30em" }}
                      >
                        <Code
                          language={language}
                          code={s.sql}
                          expandable={true}
                        />
                      </td>
                      <td>
                        {s.dateUpdated ? ago(s.dateUpdated) : <span>-</span>}
                      </td>
                      {!s.managedBy ? (
                        <td>
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
                              className={"tr-hover text-primary"}
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
                        </td>
                      ) : (
                        <td></td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!error && dimensions.length === 0 && orgCanCreateDimensions && (
        <div className="alert alert-info">
          You don&apos;t have any user dimensions defined yet.{" "}
          {hasCreateDimensionPermission &&
            "Click the button above to create your first one."}
        </div>
      )}
      {!error && dimensions.length === 0 && !orgCanCreateDimensions && (
        <div className="alert alert-info">
          It looks like you have a <code>config.yml</code> file. Dimensions
          defined there will show up on this page.{" "}
          <DocLink docSection="config_yml">View Documentation</DocLink>
        </div>
      )}
    </div>
  );
};

export default DimensionsPage;
