import { useState } from "react";
import { useRouter } from "next/router";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiArrowSquareOut, PiGlobe } from "react-icons/pi";
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
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
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
        <>
          <Heading as="h3" size="sm" mt="5" mb="2">
            Pricing
          </Heading>
          <Flex
            align="center"
            justify="between"
            gap="3"
            wrap="wrap"
            p="3"
            style={{
              background: "var(--violet-a2)",
              border: "1px solid var(--gray-a5)",
              borderRadius: "var(--radius-3)",
            }}
          >
            <Box>
              <Text as="div" weight="semibold">
                {headline}
              </Text>
              {detail ? (
                <Text as="div" color="text-mid">
                  {detail}
                </Text>
              ) : null}
            </Box>
            <Link href="https://www.growthbook.io/pricing" external>
              Pricing details <PiArrowSquareOut />
            </Link>
          </Flex>
          {pricingFootnote ? (
            <Text as="p" size="sm" color="text-mid" mt="2">
              {pricingFootnote}
            </Text>
          ) : null}
        </>
      ) : null}

      <Separator size="4" my="5" />
      <Checkbox
        value={agree}
        setValue={setAgree}
        required
        label={
          <>
            I agree to the{" "}
            <Link href="https://www.growthbook.io/legal" external>
              terms and conditions
            </Link>
          </>
        }
        description="Do not include any sensitive or regulated personal data in your analytics events unless it is properly de-identified in accordance with applicable legal standards."
      />
    </ModalStandard>
  );
}
