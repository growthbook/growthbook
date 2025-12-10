import { useRouter } from "next/router";
import { useState } from "react";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { Box, Separator, Text } from "@radix-ui/themes";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import {
  createInitialResources,
  getInitialDatasourceResources,
} from "@/services/initial-resources";
import track from "@/services/track";
import Modal from "@/components/Modal";
import Badge from "@/ui/Badge";
import SelectField from "@/components/Forms/SelectField";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";

export default function ManagedWarehouseModal({
  close,
}: {
  close: () => void;
}) {
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
        } else {
          throw new Error(`Error creating managed warehouse`);
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
            We enrich and store the events in ClickHouse within seconds.
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
