import { FC, useState } from "react";
import { FaExternalLinkAlt } from "react-icons/fa";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { isProjectListValidForProject } from "shared/util";
import { useRouter } from "next/router";
import { PiCursor, PiCursorClick } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
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

function ManagedClickhouseForm({ close }: { close: () => void }) {
  return (
    <Modal
      open={true}
      header={
        <>
          Managed ClickHouse{" "}
          <Badge label="New!" color="violet" variant="solid" />
        </>
      }
      trackingEventModalType="managed-clickhouse"
      close={close}
      submit={async () => {
        console.log("Creating");
      }}
      cta="Create"
    >
      <p>
        GrowthBook Cloud offers a fully-managed version of ClickHouse, an
        open-source database optimized for fast analytics.
      </p>

      <div className="mb-3">
        <h3>How it Works</h3>
        <p>
          You will receive a dedicated API endpoint where you can send analytics
          events (page views, button clicks, etc). You can then define metrics
          from these events and use them in experiments.
        </p>
      </div>

      <SelectField
        label="Region"
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
          2 million events included, then <strong>$0.025</strong> per 1K events
        </p>
      </div>
    </Modal>
  );
}

function ManagedClickhouseDriver() {
  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature, license } = useUser();

  const { project } = useDefinitions();

  const [open, setOpen] = useState(false);

  const hasAccess = hasCommercialFeature("managed-clickhouse");

  if (!isCloud()) {
    return null;
  }

  if (!permissionsUtil.canViewCreateDataSourceModal(project)) {
    return null;
  }

  // Must have an orb subscription (with usage-based billing)
  // TODO: provide an upgrade path for stripe subscriptions
  if (hasAccess && !license?.orbSubscription) {
    return null;
  }

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
      {open && hasAccess ? (
        <ManagedClickhouseForm close={() => setOpen(false)} />
      ) : open ? (
        <UpgradeModal
          close={() => setOpen(false)}
          commercialFeature="managed-clickhouse"
          source="datasource-list"
        />
      ) : null}
      <Flex
        style={{
          position: "relative",
          height: 225,
          maxWidth: 800,
          margin: "auto",
          overflow: "hidden",
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
            <Badge label="New!" color="violet" variant="solid" />
          ) : (
            <PaidFeatureBadge commercialFeature="managed-clickhouse" />
          )}
          <h3 className="mb-3 mt-2">
            Use GrowthBook&apos;s fully-managed warehouse to get started quickly
          </h3>
          <Button variant="outline" onClick={() => setOpen(true)}>
            <img
              src="/logo/Logo-mark.png"
              width={20}
              style={{ verticalAlign: "middle" }}
            />{" "}
            Managed ClickHouse
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
          <ManagedClickhouseDriver />

          <hr className="my-4" />
          <div className="mb-3 d-flex flex-column align-items-center justify-content-center w-100">
            <div className="mb-3">
              <h3>Or connect to your existing data warehouse:</h3>
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

            <Callout status="info" mt="5">
              Don&apos;t have a data warehouse yet? We recommend using BigQuery
              with Google Analytics.{" "}
              <DocLink docSection="ga4BigQuery">
                Learn more <FaExternalLinkAlt />
              </DocLink>
            </Callout>
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
