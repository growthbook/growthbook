import { FC, useState } from "react";
import { FaExternalLinkAlt } from "react-icons/fa";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { isProjectListValidForProject } from "shared/util";
import { useRouter } from "next/router";
import { PiCursor, PiCursorClick } from "react-icons/pi";
import { Box, Flex, Separator, Text } from "@radix-ui/themes";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { DocLink } from "@/components/DocLink";
import DataSources from "@/components/Settings/DataSources";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/components/Radix/Button";
import { hasFileConfig, isCloud } from "@/services/env";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/components/Radix/Callout";
import { dataSourceConnections } from "@/services/eventSchema";
import NewDataSourceForm from "@/components/Settings/NewDataSourceForm";
import LinkButton from "@/components/Radix/LinkButton";
import DataSourceDiagram from "@/components/InitialSetup/DataSourceDiagram";
import DataSourceTypeSelector from "@/components/Settings/DataSourceTypeSelector";
import Badge from "@/components/Radix/Badge";
import { useUser } from "@/services/UserContext";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import Checkbox from "@/components/Radix/Checkbox";
import {
  createInitialResources,
  getInitialDatasourceResources,
} from "@/services/initial-resources";

function ManagedWarehouseForm({ close }: { close: () => void }) {
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();
  const router = useRouter();

  const { hasCommercialFeature } = useUser();
  const hasAccess = hasCommercialFeature("managed-warehouse");
  const [agree, setAgree] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const settings = useOrgSettings();
  const { metricDefaults } = useOrganizationMetricDefaults();

  // Progress for the resource creation screen (final screen)
  const [resourceProgress, setResourceProgress] = useState(0);
  const [creatingResources, setCreatingResources] = useState(false);

  if (upgradeOpen) {
    return (
      <UpgradeModal
        close={() => setUpgradeOpen(false)}
        commercialFeature="managed-warehouse"
        source="datasource-list"
      />
    );
  }

  const createResources = (ds: DataSourceInterfaceWithParams) => {
    if (!ds) {
      return;
    }

    const resources = getInitialDatasourceResources({ datasource: ds });
    if (!resources.factTables.length) {
      setCreatingResources(false);
      return;
    }

    setCreatingResources(true);
    return createInitialResources({
      datasource: ds,
      onProgress: (progress) => {
        setResourceProgress(progress);
      },
      apiCall,
      metricDefaults,
      settings,
      resources,
    })
      .then(() => {
        track("Creating Datasource Resources", {
          source: "managed-warehouse",
          type: ds.type,
          schema: ds.settings?.schemaFormat,
        });
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(async () => {
        await mutateDefinitions();
        setCreatingResources(false);
      });
  };

  return (
    <Modal
      open={true}
      header={
        <>
          Managed Warehouse <Badge label="New!" color="violet" variant="soft" />
        </>
      }
      trackingEventModalType="managed-warehouse"
      close={close}
      submit={async () => {
        if (!hasAccess) {
          throw new Error("You must upgrade to use this feature");
        }
        if (!agree) {
          throw new Error("You must agree to the terms and conditions");
        }

        const res = await apiCall<{
          status: number;
          id: string;
          datasource: DataSourceInterfaceWithParams;
        }>("/datasources/managed-warehouse", {
          method: "POST",
        });

        if (res.id) {
          await createResources(res.datasource);
          await router.push(`/datasources/${res.id}`);
        }
      }}
      cta="Create"
      ctaEnabled={hasAccess}
    >
      <p>
        GrowthBook Cloud offers a fully-managed version of ClickHouse, an
        open-source database optimized for fast analytics.
      </p>

      <div className="mb-3">
        <h3>How it Works</h3>
        <ol>
          <li className="mb-2">
            You send analytics events to our scalable ingestion API.
          </li>
          <li className="mb-2">
            We enrich and store them in ClickHouse within seconds.
          </li>
          <li>
            You can query the data with SQL, define metrics, and analyze
            experiment results with our powerful stats engine.
          </li>
        </ol>
      </div>

      <SelectField
        label="Data Region"
        value="us-east-1"
        onChange={() => {}}
        options={[{ label: "AWS us-east-1", value: "us-east-1" }]}
        disabled
        helpText="This is the only region available for now."
      />

      <div className="mb-3">
        <div className="mb-1">
          <strong>Pricing</strong>
        </div>
        <p>
          2 million events included per month, then <strong>$0.03</strong> per
          1K events
        </p>
      </div>

      {hasAccess ? (
        <>
          <Separator size="4" my="4" />
          <Box>
            <Checkbox
              value={agree}
              setValue={setAgree}
              label={
                <>
                  I agree to the{" "}
                  <a
                    href="https://www.growthbook.io/legal"
                    target="_blank"
                    rel="noreferrer"
                  >
                    terms and conditions
                  </a>
                </>
              }
              required
            />
            <Box mt="2">
              <Text size="1" mb="2">
                Do not include any sensitive or regulated personal data in your
                analytics events unless it is properly de-identified in
                accordance with applicable legal standards.
              </Text>
            </Box>
          </Box>
        </>
      ) : (
        <div className="appbox bg-light p-3 text-center">
          <Text>You must upgrade to Pro to access this feature.</Text>
          <Button variant="solid" mt="3" onClick={() => setUpgradeOpen(true)}>
            Upgrade to Pro
          </Button>
        </div>
      )}
      {creatingResources ? (
        <div className="mt-2">
          <p>Creating some metrics to get you started.</p>
          <div className="progress">
            <div
              className="progress-bar"
              role="progressbar"
              style={{ width: `${Math.floor(resourceProgress * 100)}%` }}
              aria-valuenow={resourceProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function ManagedWarehouseDriver() {
  const { hasCommercialFeature } = useUser();
  const [open, setOpen] = useState(false);
  const hasAccess = hasCommercialFeature("managed-warehouse");

  const cursors: {
    top: number;
    left: number;
    rotation: number;
    click?: boolean;
  }[] = [
    { top: 176.06, left: 860.05, rotation: 73.49 },
    { top: 188, left: 869, rotation: 0 },
    { top: 219.83, left: 840, rotation: 21.58 },
    { top: 188.22, left: 830.55, rotation: 34.75 },
    { top: 197.96, left: 809.66, rotation: -6.44 },
    { top: 189.35, left: 785, rotation: 46.3 },
    { top: 212.61, left: 779, rotation: 6.24 },
    { top: 199.35, left: 747, rotation: 28.23 },
    { top: 222.79, left: 728, rotation: 29.42 },
    { top: 211.12, left: 705, rotation: 61.65 },
    { top: 201.21, left: 671.42, rotation: 4.29 },
    { top: 203.94, left: 628, rotation: 29.82 },
    { top: 211.82, left: 615.2, rotation: -31.06 },
    { top: 178.32, left: 602.44, rotation: -17.25 },
    { top: 202.61, left: 573.22, rotation: 10.53 },
    { top: 170.79, left: 562.44, rotation: 8.03, click: true },
  ];
  const minTop = 170.79;
  const minLeft = 562.44;

  return (
    <>
      {open ? <ManagedWarehouseForm close={() => setOpen(false)} /> : null}
      <Flex
        style={{
          position: "relative",
          height: 225,
          maxWidth: 800,
          margin: "auto",
          overflow: "hidden",
          background: "linear-gradient(var(--violet-2), var(--violet-4))",
        }}
        className="border rounded"
        align="center"
        justify="center"
        direction="column"
      >
        <div
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: 324,
            height: 76,
            overflow: "hidden",
            color: "var(--violet-a4)",
            pointerEvents: "none",
          }}
        >
          {cursors.map(({ top, left, rotation, click }, i) => {
            const Component = click ? PiCursorClick : PiCursor;
            return (
              <Component
                style={{
                  position: "absolute",
                  left: left - minLeft,
                  top: top - minTop + 18,
                  transformOrigin: "top left",
                  transform: `rotate(${-1 * rotation}deg)`,
                }}
                size={24}
                key={i}
              />
            );
          })}
        </div>
        <div className="text-center">
          {hasAccess ? (
            <Badge label="New!" color="violet" variant="soft" />
          ) : (
            <PaidFeatureBadge commercialFeature="managed-warehouse" />
          )}
          <h3 className="mb-3 mt-2">
            Use GrowthBook Cloud&apos;s fully-managed warehouse to get started
            quickly
          </h3>
          <Button variant="solid" onClick={() => setOpen(true)}>
            Try Now
          </Button>
        </div>
      </Flex>
    </>
  );
}

const DataSourcesPage: FC = () => {
  const {
    exists: demoDataSourceExists,
    projectId: demoProjectId,
    demoDataSourceId,
    currentProjectIsDemo,
  } = useDemoDataSourceProject();
  const { apiCall } = useAuth();
  const {
    mutateDefinitions,
    setProject,
    project,
    datasources,
  } = useDefinitions();

  const gb = useGrowthBook();

  const router = useRouter();

  const filteredDatasources = (project
    ? datasources.filter((ds) =>
        isProjectListValidForProject(ds.projects, project)
      )
    : datasources
  ).filter((ds) => !ds.projects?.includes(demoProjectId || ""));

  const [
    newModalData,
    setNewModalData,
  ] = useState<null | Partial<DataSourceInterfaceWithParams>>(null);

  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature, license } = useUser();

  // Cloud, no data sources yet, has permissions, and is either free OR on a usage-based paid plan, or is on a trial
  const showManagedWarehouse =
    isCloud() &&
    filteredDatasources.length === 0 &&
    permissionsUtil.canViewCreateDataSourceModal(project) &&
    (!hasCommercialFeature("managed-warehouse") ||
      license?.isTrial ||
      !!license?.orbSubscription) &&
    gb.isOn("inbuilt-data-warehouse");

  return (
    <div className="container-fluid pagecontents">
      {newModalData && (
        <NewDataSourceForm
          initial={newModalData || undefined}
          source="datasource-list"
          onSuccess={async (id) => {
            await mutateDefinitions({});
            await router.push(`/datasources/${id}`);
          }}
          onCancel={() => {
            setNewModalData(null);
          }}
          showImportSampleData={false}
        />
      )}
      <div className="d-flex align-items-center mb-3">
        <h1>Data Sources</h1>
        <div className="ml-auto" />
        {!hasFileConfig() && !demoDataSourceExists && (
          <Button
            onClick={async () => {
              try {
                await apiCall("/demo-datasource-project", {
                  method: "POST",
                });
                track("Create Sample Project", {
                  source: "sample-project-page",
                });
                if (demoProjectId) {
                  setProject(demoProjectId);
                }
                await mutateDefinitions();
              } catch (e: unknown) {
                console.error(e);
              }
            }}
            variant="soft"
          >
            View Sample Data Source
          </Button>
        )}
        {demoDataSourceExists && demoProjectId && demoDataSourceId ? (
          <LinkButton href={`/datasources/${demoDataSourceId}`} variant="soft">
            View Sample Data Source
          </LinkButton>
        ) : null}
        {!hasFileConfig() &&
          permissionsUtil.canViewCreateDataSourceModal(project) && (
            <Button
              disabled={currentProjectIsDemo}
              title={
                currentProjectIsDemo
                  ? "You cannot create a datasource under the demo project"
                  : ""
              }
              onClick={() => setNewModalData({})}
              ml="2"
            >
              Add Data Source
            </Button>
          )}
      </div>
      {filteredDatasources.length > 0 ? (
        <DataSources />
      ) : (
        <div className="appbox p-5 mb-3">
          <div className="text-center mt-3">
            <h2 className="h1 mb-2">
              Automatically Fetch Experiment Results &amp; Metric Values
            </h2>
            <p className="mb-4">
              GrowthBook is Warehouse Native, which means we can sit on top of
              any SQL data without storing our own copy.
              <br />
              This approach is cheaper, more secure, and more flexible.
            </p>
          </div>
          {showManagedWarehouse ? <ManagedWarehouseDriver /> : null}

          <hr className="my-4" />
          <div className="mb-3 d-flex flex-column align-items-center justify-content-center w-100">
            <div className="mb-3">
              <h3>
                {showManagedWarehouse ? "Or connect" : "Connect"} to your
                existing data warehouse:
              </h3>
            </div>

            <DataSourceTypeSelector
              value=""
              setValue={(value) => {
                const option = dataSourceConnections.find(
                  (o) => o.type === value
                );
                if (!option) return;

                setNewModalData({
                  type: option.type,
                  params: option.default,
                } as Partial<DataSourceInterfaceWithParams>);

                track("Data Source Type Selected", {
                  type: value,
                  newDatasourceForm: true,
                });
              }}
            />

            {!showManagedWarehouse ? (
              <Callout status="info" mt="5">
                Don&apos;t have a data warehouse yet? We recommend using
                BigQuery with Google Analytics.{" "}
                <DocLink docSection="ga4BigQuery">
                  Learn more <FaExternalLinkAlt />
                </DocLink>
              </Callout>
            ) : null}
          </div>
          <hr className="my-5" />
          <div className="d-flex align-items-center justify-content-center w-100">
            <DataSourceDiagram />
          </div>
        </div>
      )}
    </div>
  );
};
export default DataSourcesPage;
