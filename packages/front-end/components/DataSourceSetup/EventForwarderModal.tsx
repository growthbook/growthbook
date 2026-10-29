import { useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiArrowRight,
  PiChartBar,
  PiCode,
  PiDatabase,
  PiInfo,
} from "react-icons/pi";
import { DataSourceType } from "shared/types/datasource";
import { EventForwarderSinkType } from "shared/types/event-forwarder";
import { dataSourceConnections } from "@/services/eventSchema";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { StopSubmit } from "@/ui/Modal/StopSubmit";
import RadioCards from "@/ui/RadioCards";
import Text from "@/ui/Text";
import DataSourceOptionPricing from "./DataSourceOptionPricing";
import DataSourceTermsCheckbox from "./DataSourceTermsCheckbox";
import { useDataSourceOptionPricing } from "./useDataSourceOptionPricing";

const HOW_IT_WORKS: {
  icon: typeof PiCode;
  title: string;
  description: string;
}[] = [
  {
    icon: PiCode,
    title: "Your app sends events to GrowthBook",
    description:
      "The GrowthBook SDK sends experiment exposures, and optionally metric events, to our servers.",
  },
  {
    icon: PiDatabase,
    title: "We write them to your warehouse",
    description:
      "Events land in a dedicated schema in near real time. We keep only a short-lived backup. Your warehouse is the source of truth.",
  },
  {
    icon: PiChartBar,
    title: "Analysis runs in your warehouse",
    description:
      "Build metrics from forwarded events, or from any other table you give us read access to.",
  },
];

const WAREHOUSES = dataSourceConnections.filter(
  (connection) =>
    connection.type === "bigquery" ||
    connection.type === "snowflake" ||
    connection.type === "databricks",
);

function isEventForwarderWarehouse(
  type: DataSourceType,
): type is EventForwarderSinkType {
  return type === "bigquery" || type === "snowflake" || type === "databricks";
}

export default function EventForwarderModal({
  close,
  source,
  onSwitchToCustom,
}: {
  close: () => void;
  source: string;
  onSwitchToCustom: () => void;
}) {
  const router = useRouter();
  const { pricing, showPricing, pricingFootnote } =
    useDataSourceOptionPricing();
  const { headline, detail } = pricing["event-forwarder"];

  const [warehouse, setWarehouse] = useState<EventForwarderSinkType | null>(
    null,
  );
  const [agree, setAgree] = useState(false);

  const continueToConnect = async () => {
    if (!warehouse || !agree) throw new StopSubmit();
    const params = new URLSearchParams({
      type: warehouse,
      setup: "event_forwarder",
    });
    await router.push(`/datasources/new/connect?${params.toString()}`);
  };

  return (
    <ModalStandard
      open={true}
      header="Set Up Event Forwarder"
      cta="Continue to connect"
      ctaIcon={<PiArrowRight />}
      ctaIconPosition="right"
      ctaEnabled={!!warehouse && agree}
      submit={continueToConnect}
      close={close}
      dismissible
      size="lg"
      trackingEventModalType="event-forwarder-setup"
      trackingEventModalSource={source}
    >
      <Heading as="h3" size="sm" mb="3">
        How It Works
      </Heading>
      <Flex direction="column" gap="3">
        {HOW_IT_WORKS.map((item) => {
          const Icon = item.icon;
          return (
            <Flex key={item.title} gap="3" align="start">
              <Flex
                align="center"
                justify="center"
                flexShrink="0"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "var(--radius-2)",
                  background: "var(--violet-a3)",
                  color: "var(--violet-11)",
                }}
              >
                <Icon size={14} />
              </Flex>
              <Box>
                <Text as="div" weight="semibold">
                  {item.title}
                </Text>
                <Text as="p" size="sm" color="text-low" mb="0">
                  {item.description}
                </Text>
              </Box>
            </Flex>
          );
        })}
      </Flex>

      <Heading as="h3" size="sm" mt="5" mb="3">
        Choose Your Warehouse
      </Heading>
      <RadioCards
        columns="3"
        width="100%"
        align="center"
        labelSize="md"
        labelWeight="medium"
        value={warehouse ?? ""}
        setValue={(value) => {
          if (isEventForwarderWarehouse(value as DataSourceType)) {
            setWarehouse(value as EventForwarderSinkType);
          }
        }}
        options={WAREHOUSES.map((connection) => ({
          value: connection.type,
          label: connection.display,
          avatar: (
            <Flex align="center" flexShrink="0" style={{ fontSize: 28 }}>
              {connection.icon}
            </Flex>
          ),
        }))}
      />
      <Callout status="info" mt="3" icon={<PiInfo />}>
        Using Redshift, ClickHouse, Athena, or another warehouse? Event
        Forwarder does not support it yet.{" "}
        <Link
          onClick={() => {
            close();
            onSwitchToCustom();
          }}
        >
          Switch to a custom setup
        </Link>
        , which works with any SQL source.
      </Callout>

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
