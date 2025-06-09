import React, { FC, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { DimensionInterface } from "back-end/types/dimension";
import clsx from "clsx";
import Link from "next/link";
import { ago } from "shared/dates";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/components/Radix/Button";
import DimensionForm from "@/components/Dimensions/DimensionForm";
import { useDefinitions } from "@/services/DefinitionsContext";
import { hasFileConfig } from "@/services/env";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import { DocLink } from "@/components/DocLink";
import Code, { Language } from "@/components/SyntaxHighlighting/Code";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useSearch } from "@/services/search";
import Table, { TableBody, TableCell, TableHeader, TableRow } from "@/components/Radix/Table";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Modal from "@/components/Modal";
import router from "next/router";
import { EAQ_ANCHOR_ID } from "@/pages/datasources/[did]";

const ExposureQueryModal: FC<{
  datasourceId: string;
  exposureQueryId: string;
  close: () => void;
}> = ({ datasourceId, exposureQueryId, close }) => {
  const {
    getDatasourceById,
  } = useDefinitions();

  const datasource = getDatasourceById(datasourceId);
  if (!datasource) {
    return null;
  }

  const exposureQuery = datasource.settings.queries?.exposure?.find(eq => eq.id === exposureQueryId);
  if (!exposureQuery) {
    return null;
  }

  // TODO allow editing with AddEditExperimentAssignmentQueryModal

  return <Modal
  trackingEventModalType=""
  open={true}
  close={close}
  includeCloseCta={false}
  
  header="Exposure Query"
  >
    <Flex direction={"column"} gap="3">
      <Flex gapX={"1"}>
      <Text weight="bold">Data Source:</Text> {datasource.name}
      </Flex>
      <Flex gapX={"1"}>
      <Text weight="bold">Exposure Query:</Text> {exposureQuery.name}
      </Flex>
    </Flex>
    <Box mt="3">
    <Code language="sql" code={exposureQuery.query} />
    </Box>
  </Modal>
};


const DimensionsPage: FC = () => {
  const {
    experimentDimensions,
    dimensions,
    datasources,
    getDatasourceById,
    ready,
    error,
    mutateDefinitions,
  } = useDefinitions();

  const permissionsUtil = usePermissionsUtil();
  const canCreateDimension = permissionsUtil.canCreateDimension();
  const canEditDimension = permissionsUtil.canUpdateDimension();
  const canDeleteDimension = permissionsUtil.canDeleteDimension();

  const [
    dimensionForm,
    setDimensionForm,
  ] = useState<null | Partial<DimensionInterface>>(null);

  const [exposureQueryData, setExposureQueryData] = useState<{
    datasourceId: string;
    exposureQueryId: string;
  } | null>(null);
  const [showEditDimensionValues, setShowEditDimensionValues] = useState(false);
  const { apiCall } = useAuth();

  if (!error && !ready) {
    return <LoadingOverlay />;
  }

  const hasValidDataSources = !!datasources.filter(
    (d) => d.properties?.dimensions
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

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTH,
    pagination,
  } = useSearch({
    items: experimentDimensions.map(d => {
      const datasource = getDatasourceById(d.datasourceId);
      return {
      ...d,
      datasource: datasource,
    }}),
    localStorageKey: "dimensions",
    defaultSortField: "dimensionPriority",
    defaultSortDir: 1,
    searchFields: [
      "identifierType",
      "dimension",
      "exposureQueryName",
      //"dimensionMetadata.specifiedSlices",
    ],
    pageSize: 10,
  });
  // compute slices

  return (
    <div className="p-3 container-fluid pagecontents">
      {dimensionForm && (
        <DimensionForm
          close={() => setDimensionForm(null)}
          current={dimensionForm}
        />
      )}
      {exposureQueryData && (
        <ExposureQueryModal
          {...exposureQueryData}
          close={() => setExposureQueryData(null)}
        />
      )}
      <Flex mb="3" direction="column">
        <Box>
          <h1>Experiment Dimensions</h1>
        </Box>
        <Box mb="3">
          Experiment Dimensions are specific to the point-in-time that a unit is
          put into an experiment - for example, &quot;browser&quot; or
          &quot;referrer&quot;. They are defined via the experiment assignment queries
          and are the preferred way to specify dimensions.
        </Box>
        <Table className="appbox table gbtable responsive-table">
          <TableHeader>
            <TableRow>
              <SortableTH field="dimension">Name</SortableTH>
              <SortableTH field="datasourceId">Data Source</SortableTH>
              <SortableTH field="exposureQueryName">Exposure Query</SortableTH>
              <SortableTH field="identifierType">Identifier Type</SortableTH>
              <SortableTH field="dimensionPriority">Values</SortableTH>
              <th></th>
              {/* <SortableTH field="dimensionMetadata.specifiedSlices">Specified Slices</SortableTH> */}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              return (
              <TableRow key={item.id} className="hover-highlight">
                <TableCell>{item.dimension}</TableCell>
                <TableCell>{item.datasource && (
                          <>
                            <Link href={`/datasources/${item.datasource.id}`}>
                              {item.datasource.name}
                            </Link>{" "}
                            {item.datasource.description ? (
                              <Tooltip body={item.datasource.description} />
                            ) : null}
                          </>
                        )}</TableCell>
                <TableCell>{item.exposureQueryName}</TableCell>
                <TableCell>{item.identifierType}</TableCell>
                <TableCell>{(item.dimensionValues?.length ?? 0) > 0 ? `${item.dimensionValues?.slice(0, 4).join(", ")}${(item.dimensionValues?.length ?? 0) > 4 ? ", ..." : ""}` : ""}</TableCell>

               <TableCell>
                <MoreMenu useRadix={true}>
                <a
                  className="dropdown-item"
                  href={`/datasources/${item.datasourceId}#${EAQ_ANCHOR_ID}`}
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(`/datasources/${item.datasourceId}#${EAQ_ANCHOR_ID}`);
                  }}
                >
                  Edit Via Data Source
                </a>
                </MoreMenu></TableCell>
              </TableRow>
            )})}
          </TableBody>
        </Table>
        {pagination}
      </Flex>
      <div className="row mb-3">
        <div className="col-auto d-flex">
          <h1>Unit Dimensions</h1>
        </div>
        <div style={{ flex: 1 }}></div>
        {!hasFileConfig() && canCreateDimension && (
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
                  {!hasFileConfig() && <th>Date Updated</th>}
                  {!hasFileConfig() && <th></th>}
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
                      {/* @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'Date | null' is not assignable t... Remove this comment to see the full error message */}
                      {!hasFileConfig() && <td>{ago(s.dateUpdated)}</td>}
                      {!hasFileConfig() && (
                        <td>
                          {canEditDimension ? (
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
                          {canDeleteDimension ? (
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
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!error && dimensions.length === 0 && !hasFileConfig() && (
        <div className="alert alert-info">
          You don&apos;t have any user dimensions defined yet.{" "}
          {canCreateDimension &&
            "Click the button above to create your first one."}
        </div>
      )}
      {!error && dimensions.length === 0 && hasFileConfig() && (
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
