import { ReactNode, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import {
  PiArrowLeft,
  PiArrowRight,
  PiArrowSquareOut,
  PiChartBar,
  PiCheck,
  PiCode,
  PiDatabase,
  PiInfo,
  PiQuestion,
} from "react-icons/pi";
import { DataSourceType } from "shared/types/datasource";
import { EventForwarderSinkType } from "shared/types/event-forwarder";
import {
  EventForwarderWarehouseArea,
  EventForwarderWarehouseRegion,
  getEventForwarderWarehouseRegion,
  listEventForwarderWarehouseRegions,
} from "shared/util";
import { dataSourceConnections } from "@/services/eventSchema";
import { DataRegion, useDataRegionOptions } from "@/services/dataRegions";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Modal from "@/ui/Modal";
import RadioCards from "@/ui/RadioCards";
import { Select, SelectGroup, SelectItem, SelectLabel } from "@/ui/Select";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
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

function ingestorForRegion(region: DataRegion): string {
  return region === "eu-west-1" ? "EU ingestor" : "US ingestor";
}

function warehouseRegionHelp(sinkType: EventForwarderSinkType): ReactNode {
  switch (sinkType) {
    case "bigquery":
      return "Open the dataset in the BigQuery console. Location is under Dataset info.";
    case "snowflake":
      return (
        <>
          The region is in your Snowflake account URL, or run{" "}
          <code>SELECT CURRENT_REGION()</code>.
        </>
      );
    case "databricks":
      return "Open Workspaces in the Databricks account console. The region is listed for your workspace.";
  }
}

function StepIndicator({
  step,
  warehouseName,
}: {
  step: 1 | 2;
  warehouseName: string | null;
}) {
  const steps = [
    { n: 1, label: step > 1 && warehouseName ? warehouseName : "Warehouse" },
    { n: 2, label: "Region" },
    { n: 3, label: "Connect" },
  ];

  return (
    <Flex align="center" gap="2" wrap="wrap">
      {steps.map((item, index) => {
        const done = item.n < step;
        const current = item.n === step;
        return (
          <Flex key={item.n} align="center" gap="2">
            {index > 0 ? (
              <Box
                style={{
                  width: 28,
                  height: 1,
                  background: "var(--gray-a6)",
                }}
              />
            ) : null}
            <Flex align="center" gap="2">
              <Flex
                align="center"
                justify="center"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: done
                    ? "var(--green-a3)"
                    : current
                      ? "var(--violet-9)"
                      : "transparent",
                  color: done
                    ? "var(--green-11)"
                    : current
                      ? "white"
                      : "var(--color-text-mid)",
                  border:
                    done || current ? "none" : "1.5px solid var(--gray-a8)",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {done ? <PiCheck size={12} /> : item.n}
              </Flex>
              <Text
                size="sm"
                weight={current ? "semibold" : "regular"}
                color={current || done ? "text-high" : "text-mid"}
              >
                {item.label}
              </Text>
            </Flex>
          </Flex>
        );
      })}
    </Flex>
  );
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
  const dataRegionOptions = useDataRegionOptions();
  const { pricing, showPricing, pricingFootnote } =
    useDataSourceOptionPricing();
  const { headline, detail } = pricing["event-forwarder"];

  const [step, setStep] = useState<1 | 2>(1);
  const [warehouse, setWarehouse] = useState<EventForwarderSinkType | null>(
    null,
  );
  const [warehouseRegionId, setWarehouseRegionId] = useState("");
  const [agree, setAgree] = useState(false);

  const allowedRegions = useMemo(
    () => new Set<DataRegion>(dataRegionOptions.map((option) => option.value)),
    [dataRegionOptions],
  );

  const warehouseRegions = useMemo(() => {
    if (!warehouse) return [];
    return listEventForwarderWarehouseRegions(warehouse).filter((region) =>
      allowedRegions.has(region.growthBookRegion),
    );
  }, [warehouse, allowedRegions]);

  const selectedRegion = warehouse
    ? getEventForwarderWarehouseRegion(warehouse, warehouseRegionId)
    : null;
  const growthBookRegion =
    selectedRegion && allowedRegions.has(selectedRegion.growthBookRegion)
      ? selectedRegion.growthBookRegion
      : null;

  const regionsByArea = useMemo(() => {
    const groups: {
      area: EventForwarderWarehouseArea;
      regions: EventForwarderWarehouseRegion[];
    }[] = [];
    for (const region of warehouseRegions) {
      const group = groups.find((item) => item.area === region.area);
      if (group) {
        group.regions.push(region);
      } else {
        groups.push({ area: region.area, regions: [region] });
      }
    }
    return groups;
  }, [warehouseRegions]);

  const warehouseName =
    WAREHOUSES.find((connection) => connection.type === warehouse)?.display ??
    null;
  const regionHelp = warehouse ? warehouseRegionHelp(warehouse) : null;

  const goToRegion = () => {
    if (!warehouse) return;
    const regions = listEventForwarderWarehouseRegions(warehouse).filter(
      (region) => allowedRegions.has(region.growthBookRegion),
    );
    if (!regions.some((region) => region.id === warehouseRegionId)) {
      setWarehouseRegionId("");
    }
    setStep(2);
  };

  const continueToConnect = async () => {
    if (!warehouse || !growthBookRegion) return;
    const params = new URLSearchParams({
      type: warehouse,
      setup: "event_forwarder",
      region: growthBookRegion,
    });
    await router.push(`/datasources/new/connect?${params.toString()}`);
  };

  return (
    <Modal.Root
      open={true}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      size="lg"
      dismissible
      trackingEventModalType="event-forwarder-setup"
      trackingEventModalSource={source}
    >
      <Modal.Header>
        <Flex direction="column" gap="3" width="100%">
          <Modal.Title>Set Up Event Forwarder</Modal.Title>
          <StepIndicator step={step} warehouseName={warehouseName} />
        </Flex>
      </Modal.Header>
      <Modal.Body>
        {step === 1 ? (
          <>
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
              columns="2"
              width="100%"
              align="center"
              labelSize="md"
              labelWeight="medium"
              value={warehouse ?? ""}
              setValue={(value) => {
                if (isEventForwarderWarehouse(value as DataSourceType)) {
                  setWarehouse(value as EventForwarderSinkType);
                  setWarehouseRegionId("");
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
          </>
        ) : (
          <>
            <Flex align="center" gap="1" mb="1">
              <Heading as="h3" size="sm" mb="0">
                Warehouse Region
              </Heading>
              {regionHelp ? (
                <Tooltip content={regionHelp} maxWidth="280px">
                  <IconButton
                    type="button"
                    variant="ghost"
                    color="gray"
                    size="1"
                    aria-label="How to find your warehouse region"
                  >
                    <PiQuestion />
                  </IconButton>
                </Tooltip>
              ) : null}
            </Flex>
            <Text as="p" color="text-mid" mb="3">
              Tell us where your warehouse is located. GrowthBook uses this to
              route events to our US or EU ingestor. This cannot be changed
              later.
            </Text>
            <Select
              aria-label="Warehouse region"
              value={warehouseRegionId || undefined}
              setValue={setWarehouseRegionId}
              placeholder="Select a region"
            >
              {regionsByArea.map((group) => (
                <SelectGroup key={group.area}>
                  <SelectLabel>{group.area}</SelectLabel>
                  {group.regions.map((region) => (
                    <SelectItem key={region.id} value={region.id}>
                      {`${region.cloud} ${region.label}`}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </Select>
            {growthBookRegion ? (
              <Text as="p" size="sm" color="text-mid" mt="2" mb="0">
                Events will be routed to GrowthBook&apos;s{" "}
                <code>{ingestorForRegion(growthBookRegion)}</code>, then written
                to your warehouse.
              </Text>
            ) : null}

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
          </>
        )}
      </Modal.Body>
      <Modal.Footer justify={step === 1 ? "end" : "between"}>
        {step === 1 ? (
          <Modal.Close>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          </Modal.Close>
        ) : (
          <Button
            variant="ghost"
            icon={<PiArrowLeft />}
            onClick={() => setStep(1)}
          >
            Back
          </Button>
        )}
        {step === 1 ? (
          <Button disabled={!warehouse} onClick={goToRegion}>
            Next
          </Button>
        ) : (
          <Button
            disabled={!growthBookRegion || !agree}
            icon={<PiArrowRight />}
            iconPosition="right"
            onClick={continueToConnect}
          >
            Continue to connect
          </Button>
        )}
      </Modal.Footer>
    </Modal.Root>
  );
}
