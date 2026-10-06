import { ReactNode, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, Inset, Separator } from "@radix-ui/themes";
import {
  PiArrowLeft,
  PiArrowRight,
  PiArrowSquareOut,
  PiChartBar,
  PiCode,
  PiDatabase,
  PiGlobe,
} from "react-icons/pi";
import { DataSourceType } from "shared/types/datasource";
import { supportsEventForwarder } from "shared/util";
import { dataSourceConnections } from "@/services/eventSchema";
import {
  DEFAULT_DATA_REGION,
  DataRegion,
  useDataRegionOptions,
} from "@/services/dataRegions";
import Avatar from "@/ui/Avatar";
import Modal from "@/ui/Modal";
import RadioCards from "@/ui/RadioCards";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import { DATA_SOURCE_TYPE_AVATAR } from "./dataSourceTypeAvatar";
import { useDataSourceOptionPricing } from "./useDataSourceOptionPricing";

const REGION_NAMES: Record<DataRegion, string> = {
  "us-east-1": "United States",
  "eu-west-1": "European Union",
};

const HOW_IT_WORKS: { icon: ReactNode; title: string; description: string }[] =
  [
    {
      icon: <PiCode size={16} />,
      title: "Your app sends events to GrowthBook",
      description:
        "The GrowthBook SDK sends experiment exposures, and optionally metric events, to our servers.",
    },
    {
      icon: <PiDatabase size={16} />,
      title: "We write them to your warehouse",
      description:
        "Events land in a dedicated schema in near real time. We keep only a short-lived backup. Your warehouse is the source of truth.",
    },
    {
      icon: <PiChartBar size={16} />,
      title: "Analysis runs in your warehouse",
      description:
        "Build metrics from forwarded events, or from any other table you give us read access to.",
    },
  ];

const warehouses = dataSourceConnections.filter((connection) =>
  supportsEventForwarder({ type: connection.type }),
);

function Stepper({
  step,
  warehouseName,
}: {
  step: 1 | 2;
  warehouseName: string;
}) {
  const steps = [
    step > 1 ? warehouseName : "Warehouse",
    "Region and terms",
    "Connect",
  ];

  return (
    <Flex align="center" gap="3" wrap="wrap">
      {steps.map((label, index) => {
        const number = index + 1;
        const done = number < step;
        const current = number === step;
        return (
          <Flex key={label} align="center" gap="3">
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
                      : "var(--gray-11)",
                  border:
                    done || current ? "none" : "1.5px solid var(--gray-a8)",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {number}
              </Flex>
              <Text
                size="sm"
                weight={current ? "medium" : "regular"}
                color={current || done ? "text-high" : "text-mid"}
              >
                {label}
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
  onSwitchToCustom,
  source,
}: {
  close: () => void;
  onSwitchToCustom: () => void;
  source: string;
}) {
  const router = useRouter();
  const dataRegionOptions = useDataRegionOptions();
  const { pricing, showPricing, pricingFootnote } =
    useDataSourceOptionPricing();
  const { headline, detail } = pricing["event-forwarder"];

  const [step, setStep] = useState<1 | 2>(1);
  const [type, setType] = useState<DataSourceType>(
    warehouses[0]?.type ?? "bigquery",
  );
  const [region, setRegion] = useState<DataRegion>(DEFAULT_DATA_REGION);
  const [agree, setAgree] = useState(false);

  const warehouseName =
    warehouses.find((connection) => connection.type === type)?.display ??
    "Warehouse";

  const continueToConnect = async () => {
    const params = new URLSearchParams({
      type,
      setup: "event_forwarder",
      region,
    });
    await router.push(`/datasources/new/connect?${params.toString()}`);
    close();
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
        <Modal.Title>Set Up Event Forwarder</Modal.Title>
      </Modal.Header>
      <Box flexShrink="0" pt="4" pb="4" pr="7">
        <Stepper step={step} warehouseName={warehouseName} />
      </Box>
      <Inset side="x">
        <Separator size="4" />
      </Inset>
      <Modal.Body>
        {step === 1 ? (
          <>
            <Heading as="h3" size="sm" mb="3">
              How It Works
            </Heading>
            <Flex direction="column" gap="4">
              {HOW_IT_WORKS.map((item) => (
                <Flex key={item.title} gap="3" align="start">
                  <Flex
                    align="center"
                    justify="center"
                    flexShrink="0"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: "var(--violet-a3)",
                      color: "var(--violet-11)",
                    }}
                  >
                    {item.icon}
                  </Flex>
                  <Box>
                    <Text as="div" weight="medium">
                      {item.title}
                    </Text>
                    <Text as="div" size="sm" color="text-low" mt="1">
                      {item.description}
                    </Text>
                  </Box>
                </Flex>
              ))}
            </Flex>

            <Heading as="h3" size="sm" mt="5" mb="3">
              Choose Your Warehouse
            </Heading>
            <RadioCards
              columns="2"
              width="100%"
              align="center"
              value={type}
              setValue={(value) => setType(value as DataSourceType)}
              options={warehouses.map((connection) => {
                const avatar = DATA_SOURCE_TYPE_AVATAR[connection.type];
                return {
                  value: connection.type,
                  label: connection.display,
                  avatar: (
                    <Avatar
                      size="sm"
                      variant="soft"
                      radius="small"
                      color={avatar.color}
                    >
                      {avatar.abbr}
                    </Avatar>
                  ),
                };
              })}
            />
            <Callout status="info" mt="3">
              Using Redshift, ClickHouse, Athena, or another warehouse? Event
              Forwarder doesn&apos;t support it yet.{" "}
              <Link
                onClick={() => {
                  onSwitchToCustom();
                }}
              >
                Switch to a custom Data Source
              </Link>
              .
            </Callout>
          </>
        ) : (
          <>
            <Heading as="h3" size="sm" mb="1">
              Data Region
            </Heading>
            <Text as="p" color="text-mid" mb="3">
              Where events pass through GrowthBook before they are written to
              your warehouse. This cannot be changed later.
            </Text>
            <RadioCards
              columns="2"
              width="100%"
              align="center"
              value={region}
              setValue={(value) => setRegion(value as DataRegion)}
              options={dataRegionOptions.map((option) => ({
                value: option.value,
                label: REGION_NAMES[option.value],
                description: option.label,
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
              description="Event data passes through GrowthBook's servers in the selected region. Do not include any sensitive or regulated personal data in your analytics events unless it is properly de-identified in accordance with applicable legal standards."
            />
          </>
        )}
      </Modal.Body>
      {step === 1 ? (
        <Modal.Footer>
          <Modal.Close>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          </Modal.Close>
          <Button onClick={() => setStep(2)}>Next</Button>
        </Modal.Footer>
      ) : (
        <Modal.Footer justify="between">
          <Button
            variant="ghost"
            icon={<PiArrowLeft />}
            onClick={() => setStep(1)}
          >
            Back
          </Button>
          <Button
            disabled={!agree}
            icon={<PiArrowRight />}
            iconPosition="right"
            onClick={continueToConnect}
          >
            Continue to connect
          </Button>
        </Modal.Footer>
      )}
    </Modal.Root>
  );
}
