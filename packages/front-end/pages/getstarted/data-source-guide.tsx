import { PiCheckCircleFill } from "react-icons/pi";
import { useState, useEffect } from "react";
import Link from "next/link";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { Box, Grid, Separator } from "@radix-ui/themes";
import DocumentationSidebar from "@/components/GetStarted/DocumentationSidebar";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useGetStarted } from "@/services/GetStartedProvider";
import Frame from "@/ui/Frame";
import DataSourceDiagram from "@/components/InitialSetup/DataSourceDiagram";
import ViewSampleDataButton from "@/components/GetStarted/ViewSampleDataButton";

// Also used for the `Launch Setup Flow` button to keep it aligned
const DOCUMENTATION_SIDEBAR_WIDTH = "minmax(0, 245px)";

const DataSourceGuide = (): React.ReactElement => {
  const { organization } = useUser();
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const {
    factTables,
    datasources,
    ready: definitionsReady,
    project,
    factMetrics,
    error,
  } = useDefinitions();
  const { setStep, clearStep } = useGetStarted();

  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    organization.id || "",
  );

  // If they view the guide, clear the current step
  useEffect(() => {
    clearStep();
  }, [clearStep]);

  const loading = !definitionsReady;

  if (loading) {
    return <LoadingOverlay />;
  }

  if (error) {
    return <div className="alert alert-danger">{error}</div>;
  }

  // Ignore the demo datasource for all checks
  const hasFactTables = project
    ? factTables.some(
        (f) =>
          (f.projects.includes(project) || f.projects.length === 0) &&
          !f.projects.includes(demoProjectId),
      )
    : factTables.some((f) => !f.projects.includes(demoProjectId));
  const hasFactMetrics = project
    ? factMetrics.some(
        (m) =>
          (m.projects.includes(project) || m.projects.length === 0) &&
          !m.projects.includes(demoProjectId),
      )
    : factMetrics.some((m) => !m.projects.includes(demoProjectId));
  const hasDatasource = project
    ? datasources.some(
        (d) =>
          (d.projects?.includes(project) || d.projects?.length === 0) &&
          !d.projects?.includes(demoProjectId),
      )
    : datasources.some((d) => !d.projects?.includes(demoProjectId));

  return (
    <div className="container pagecontents p-4">
      <PageHead
        breadcrumb={[
          { display: "Get Started", href: "/getstarted" },
          { display: "Data & Metrics" },
        ]}
      />
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="get-started-data-source-guide"
          commercialFeature={null}
        />
      )}
      <Grid
        columns={{
          initial: "1fr",
          sm: `minmax(0, 1fr) ${DOCUMENTATION_SIDEBAR_WIDTH}`,
        }}
        gapX="4"
        mt="4"
      >
        <Box style={{ minWidth: 500 }}>
          <h1 className="mb-3 mr-3">Set up Data Source & Metrics</h1>
          <Frame>
            <div className="d-flex align-items-center justify-content-center w-100">
              <DataSourceDiagram />
            </div>
          </Frame>
          <div className="appbox p-4">
            <div className="row">
              <div className="col-sm-auto">
                {hasDatasource ? (
                  <PiCheckCircleFill
                    className="mt-1"
                    style={{
                      fill: "#56BA9F",
                      width: "18.5px",
                      height: "18.5px",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      borderRadius: "50%",
                      borderStyle: "solid",
                      borderWidth: "0.6px",
                      borderColor: "#D3D4DB",
                      width: "15px",
                      height: "15px",
                      margin: "2px",
                    }}
                  />
                )}
              </div>
              <div className="col">
                <Link
                  href="/datasources"
                  style={{
                    fontSize: "17px",
                    fontWeight: 600,
                    textDecoration: hasDatasource ? "line-through" : "none",
                  }}
                  onClick={() =>
                    setStep({
                      step: "Connect a Data Source",
                      source: "dataSourceGuide",
                      stepKey: "connectDataWarehouse",
                    })
                  }
                >
                  Connect a Data Source
                </Link>
                <Box mt="2">
                  To analyze experiment results, connect an event tracker and
                  data source.
                </Box>
                <Separator size="4" my="4" />
              </div>
            </div>

            <div className="row">
              <div className="col-sm-auto">
                {hasFactTables ? (
                  <PiCheckCircleFill
                    className="mt-1"
                    style={{
                      fill: "#56BA9F",
                      width: "18.5px",
                      height: "18.5px",
                    }}
                  />
                ) : (
                  <div
                    className="mt-1"
                    style={{
                      borderRadius: "50%",
                      borderStyle: "solid",
                      borderWidth: "0.6px",
                      borderColor: "#D3D4DB",
                      width: "15px",
                      height: "15px",
                      margin: "2px",
                    }}
                  />
                )}
              </div>
              <div className="col">
                <Link
                  href="/fact-tables"
                  style={{
                    fontSize: "17px",
                    fontWeight: 600,
                    textDecoration: hasFactTables ? "line-through" : "none",
                  }}
                  onClick={() =>
                    setStep({
                      step: "Create a Fact Table",
                      source: "dataSourceGuide",
                      stepKey: "createFactTable",
                    })
                  }
                >
                  Create a Fact Table
                </Link>
                <Box mt="2">
                  Fact Tables are defined by a SQL SELECT statement and serve as
                  the base on which metrics are built.
                </Box>
                <Separator size="4" my="4" />
              </div>
            </div>

            <div className="row">
              <div className="col-sm-auto">
                {hasFactMetrics ? (
                  <PiCheckCircleFill
                    className="mt-1"
                    style={{
                      fill: "#56BA9F",
                      width: "18.5px",
                      height: "18.5px",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      borderRadius: "50%",
                      borderStyle: "solid",
                      borderWidth: "0.6px",
                      borderColor: "#D3D4DB",
                      width: "15px",
                      height: "15px",
                      margin: "2px",
                    }}
                  />
                )}
              </div>
              <div className="col">
                <Link
                  href="/fact-tables"
                  style={{
                    fontSize: "17px",
                    fontWeight: 600,
                    textDecoration: hasFactMetrics ? "line-through" : "none",
                  }}
                  onClick={() =>
                    setStep({
                      step: "Add Metrics",
                      source: "dataSourceGuide",
                      stepKey: "addMetric",
                    })
                  }
                >
                  Add Metrics
                </Link>
                <Box mt="2">
                  Add Proportion, Mean, Quantile, or Ratio metrics on top of
                  Fact Tables.
                </Box>
              </div>
            </div>
          </div>
        </Box>
        <Box>
          <Box mb="3">
            <ViewSampleDataButton />
          </Box>
          <DocumentationSidebar
            setUpgradeModal={setUpgradeModal}
            type="data-source"
          />
        </Box>
      </Grid>
    </div>
  );
};

export default DataSourceGuide;
