import { PiArrowRight, PiCheckCircleFill } from "react-icons/pi";
import { useState, useEffect } from "react";
import Link from "next/link";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { Box, Separator } from "@radix-ui/themes";
import DocumentationSidebar from "@/components/GetStarted/DocumentationSidebar";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import { useExperiments } from "@/hooks/useExperiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useGetStarted } from "@/services/GetStartedProvider";
import Frame from "@/ui/Frame";
import DataSourceDiagram from "@/components/InitialSetup/DataSourceDiagram";
import ViewSampleDataButton from "@/components/GetStarted/ViewSampleDataButton";

const DataSourceGuide = (): React.ReactElement => {
  const { organization } = useUser();
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { experiments, loading: experimentsLoading, error } = useExperiments();
  const {
    factTables,
    datasources,
    ready: definitionsReady,
    project,
    factMetrics,
  } = useDefinitions();
  const { setStep, clearStep } = useGetStarted();

  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    organization.id || "",
  );

  // If they view the guide, clear the current step
  useEffect(() => {
    clearStep();
  }, [clearStep]);

  const loading = experimentsLoading && !definitionsReady;

  if (loading) {
    return <LoadingOverlay />;
  }

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }

  // Ignore the demo datasource
  const hasExperiments = project
    ? experiments.some(
        (e) => e.project !== demoProjectId && e.project === project,
      )
    : experiments.some((e) => e.project !== demoProjectId);

  const hasFactTables = factTables.length > 0;
  const hasFactMetrics = factMetrics.length > 0;
  // Ignore the demo datasource
  const hasDatasource = datasources.some(
    (d) => !d.projects?.includes(demoProjectId),
  );

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
      {/* <div className="d-flex align-middle justify-content-between mb-4">
        <h1 className="mb-3 mr-3">Set up Data Source & Metrics</h1>
        <ViewSampleDataButton />
      </div> */}
      <div className="row mt-4">
        <div className="col mr-auto" style={{ minWidth: 500 }}>
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
                      step: "Define Fact Tables and Metrics",
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
                  href="/experiments?analyzeExisting=true"
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
        </div>
        <div className="col-auto">
          <Box mb="3">
            <ViewSampleDataButton />
          </Box>
          <DocumentationSidebar
            setUpgradeModal={setUpgradeModal}
            type="data-source"
          />
        </div>
      </div>
    </div>
  );
};

export default DataSourceGuide;
