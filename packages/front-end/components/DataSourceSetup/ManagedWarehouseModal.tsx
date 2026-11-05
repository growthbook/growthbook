import { useState } from "react";
import { useRouter } from "next/router";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { PiGlobe } from "react-icons/pi";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import {
  DEFAULT_DATA_REGION,
  DataRegion,
  useDataRegionOptions,
} from "@/services/dataRegions";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  createInitialResources,
  getInitialDatasourceResources,
} from "@/services/initial-resources";
import track from "@/services/track";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RadioCards from "@/ui/RadioCards";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import DataSourceOptionPricing from "./DataSourceOptionPricing";
import DataSourceTermsCheckbox from "./DataSourceTermsCheckbox";
import { useDataSourceOptionPricing } from "./useDataSourceOptionPricing";

const REGION_NAMES: Record<DataRegion, string> = {
  "us-east-1": "United States",
  "eu-west-1": "European Union",
};

export default function ManagedWarehouseModal({
  close,
  source,
}: {
  close: () => void;
  source: string;
}) {
  const router = useRouter();
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();
  const settings = useOrgSettings();
  const { metricDefaults } = useOrganizationMetricDefaults();
  const dataRegionOptions = useDataRegionOptions();
  const { pricing, showPricing, pricingFootnote } =
    useDataSourceOptionPricing();
  const { headline, detail } = pricing.managed;

  const [region, setRegion] = useState<DataRegion>(DEFAULT_DATA_REGION);
  const [agree, setAgree] = useState(false);

  // Seeds the starter fact tables and metrics. Failures here shouldn't block
  // the warehouse itself, so they're logged rather than surfaced.
  const createResources = async (datasource: DataSourceInterfaceWithParams) => {
    const resources = getInitialDatasourceResources({
      datasource,
      attributeSchema: settings.attributeSchema,
    });
    if (!resources.factTables.length) return;

    try {
      await createInitialResources({
        datasource,
        apiCall,
        metricDefaults,
        settings,
        resources,
      });
      track("Creating Datasource Resources", {
        source: "managed-warehouse",
        type: datasource.type,
        schema: datasource.settings?.schemaFormat,
      });
    } catch (e) {
      console.error(e);
    }
  };

  const createManagedWarehouse = async () => {
    const res = await apiCall<{
      status: number;
      id: string;
      datasource: DataSourceInterfaceWithParams;
    }>("/datasources/managed-warehouse", {
      method: "POST",
      body: JSON.stringify({ region }),
    });
    if (!res.id) {
      throw new Error("Error creating managed warehouse");
    }

    await createResources(res.datasource);
    await mutateDefinitions();
    await router.push(`/datasources/${res.id}`);
  };

  return (
    <ModalStandard
      open={true}
      header="Set Up Managed Warehouse"
      cta="Create Managed Warehouse"
      ctaEnabled={agree}
      submit={createManagedWarehouse}
      close={close}
      // Dismissible until submit; Root locks escape and outside click while loading.
      dismissible
      size="lg"
      trackingEventModalType="managed-warehouse"
      trackingEventModalSource={source}
    >
      <Heading as="h3" size="sm" mb="1">
        Data Region
      </Heading>
      <Text as="p" color="text-mid" mb="3">
        Where your event data will be ingested and stored. This cannot be
        changed later.
      </Text>
      <RadioCards
        columns="2"
        width="100%"
        align="center"
        value={region}
        setValue={(value) => setRegion(value as DataRegion)}
        options={dataRegionOptions.map((o) => ({
          value: o.value,
          label: REGION_NAMES[o.value],
          description: o.label,
          avatar: <PiGlobe size={20} color="var(--violet-11)" />,
        }))}
      />

      {showPricing ? (
        <DataSourceOptionPricing
          headline={headline}
          detail={detail}
          footnote={pricingFootnote}
        />
      ) : null}

      <DataSourceTermsCheckbox value={agree} setValue={setAgree} />
    </ModalStandard>
  );
}
