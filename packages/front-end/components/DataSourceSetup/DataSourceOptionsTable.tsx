import { ReactNode, useState } from "react";
import { useRouter } from "next/router";
import { Flex } from "@radix-ui/themes";
import {
  PiArrowSquareOut,
  PiCheck,
  PiInfo,
  PiLightning,
  PiMinus,
  PiPaperPlaneTilt,
  PiSlidersHorizontal,
} from "react-icons/pi";
import { CommercialFeature } from "shared/enterprise";
import { supportsEventForwarder } from "shared/util";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
  TableRowHeaderCell,
} from "@/ui/Table";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { dataSourceConnections } from "@/services/eventSchema";
import { DocLink, DocSection } from "@/components/DocLink";
import Tooltip from "@/components/Tooltip/Tooltip";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { GBPremiumBadge } from "@/components/Icons";
import { useDefinitions } from "@/services/DefinitionsContext";
import NewDataSourceForm from "@/components/Settings/NewDataSourceForm";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import {
  DataSourceOptionKey,
  useDataSourceOptionEligibility,
} from "./useDataSourceOptionEligibility";
import { useDataSourceOptionPricing } from "./useDataSourceOptionPricing";
import SampleDataSourceLink from "./SampleDataSourceLink";
import ManagedWarehouseModal from "./ManagedWarehouseModal";

const OPTION_KEYS: DataSourceOptionKey[] = [
  "managed",
  "event-forwarder",
  "custom",
];

const eventForwarderConnections = dataSourceConnections.filter((o) =>
  supportsEventForwarder({ type: o.type }),
);

const OPTION_HEADS: Record<
  DataSourceOptionKey,
  {
    icon: ReactNode;
    name: string;
    badge: string;
    description: string;
    docSection: DocSection;
    commercialFeature?: CommercialFeature;
  }
> = {
  managed: {
    icon: <PiLightning size={16} />,
    name: "Managed Warehouse",
    badge: "Fastest to start",
    description: "GrowthBook fully owns the data pipeline and storage.",
    docSection: "growthbook_clickhouse",
  },
  "event-forwarder": {
    icon: <PiPaperPlaneTilt size={16} />,
    name: "Event Forwarder",
    badge: "Easiest warehouse-native",
    description:
      "GrowthBook manages the pipeline. Data is stored in your warehouse.",
    docSection: "eventForwarder",
    commercialFeature: "events-forwarder",
  },
  custom: {
    icon: <PiSlidersHorizontal size={16} />,
    name: "Custom",
    badge: "Most flexible",
    description: "You fully manage all data pipelines and storage.",
    docSection: "warehouses",
  },
};

const OPTION_COLUMN_STYLE = { borderLeft: "1px solid var(--gray-a5)" };

type OptionAction = {
  label: string;
  variant: "solid" | "outline";
  onClick: () => void;
  icon?: ReactNode;
  reason?: string;
};

type Indicator = "yes" | "no";

const INDICATOR_ICONS: Record<Indicator, ReactNode> = {
  yes: <PiCheck size={16} color="var(--green-11)" />,
  no: <PiMinus size={16} color="var(--gray-9)" />,
};

type ComparisonCell = { indicator?: Indicator; text: string; detail?: string };

const COMPARISON_ROWS: {
  label: string;
  tooltip?: string;
  cells: Record<DataSourceOptionKey, ComparisonCell>;
}[] = [
  {
    label: "Send events to",
    tooltip:
      "Events are records of what users do in your app, like viewing an experiment or making a purchase. This is where your app sends them.",
    cells: {
      managed: { text: "GrowthBook" },
      "event-forwarder": { text: "GrowthBook" },
      custom: { text: "Your data pipeline" },
    },
  },
  {
    label: "Store events in",
    tooltip:
      "Where your event data is kept. GrowthBook runs experiment analysis against this storage.",
    cells: {
      managed: { text: "GrowthBook" },
      "event-forwarder": {
        text: "Your warehouse",
        detail: eventForwarderConnections.map((o) => o.display).join(", "),
      },
      custom: { text: "Your warehouse", detail: "Any SQL source" },
    },
  },
  {
    label: "Use your existing data",
    tooltip:
      "Whether you can analyze data that's already in your warehouse, like orders or signups, alongside the events you send.",
    cells: {
      managed: { indicator: "no", text: "No" },
      "event-forwarder": { indicator: "yes", text: "Yes" },
      custom: { indicator: "yes", text: "Yes" },
    },
  },
];

function OptionHead({
  option,
  upgradeRequired,
}: {
  option: DataSourceOptionKey;
  upgradeRequired: boolean;
}) {
  const { icon, name, badge, description, docSection, commercialFeature } =
    OPTION_HEADS[option];
  return (
    <Flex direction="column" gap="2" align="start">
      <Flex align="center" gap="2">
        <Flex
          align="center"
          justify="center"
          style={{
            width: 28,
            height: 28,
            borderRadius: "var(--radius-2)",
            background: "var(--violet-a3)",
            color: "var(--violet-11)",
          }}
        >
          {icon}
        </Flex>
        <Text size="lg" weight="semibold">
          {name}
        </Text>
        {upgradeRequired && commercialFeature ? (
          <PaidFeatureBadge commercialFeature={commercialFeature} />
        ) : null}
      </Flex>
      <Badge label={badge} color="violet" variant="soft" />
      <Text color="text-mid" weight="regular">
        {description}{" "}
        <DocLink docSection={docSection}>
          <span style={{ whiteSpace: "nowrap" }}>
            Learn more <PiArrowSquareOut style={{ verticalAlign: "middle" }} />
          </span>
        </DocLink>
      </Text>
    </Flex>
  );
}

// Keeps the icon on the same line as the last word so it never wraps alone.
function LabelWithTooltip({
  label,
  tooltip,
}: {
  label: string;
  tooltip: string;
}) {
  const splitAt = label.lastIndexOf(" ") + 1;
  return (
    <>
      {label.slice(0, splitAt)}
      <span style={{ whiteSpace: "nowrap" }}>
        {label.slice(splitAt)}
        <Tooltip body={tooltip}>
          <PiInfo
            size={16}
            style={{
              color: "var(--violet-11)",
              verticalAlign: "middle",
              marginLeft: 4,
            }}
          />
        </Tooltip>
      </span>
    </>
  );
}

function ComparisonCellContent({ indicator, text, detail }: ComparisonCell) {
  return (
    <Flex align="center" gap="2">
      {indicator ? INDICATOR_ICONS[indicator] : null}
      <Flex direction="column">
        <Text color={indicator === "no" ? "text-mid" : undefined}>{text}</Text>
        {detail ? (
          <Text size="sm" color="text-mid">
            {detail}
          </Text>
        ) : null}
      </Flex>
    </Flex>
  );
}

export default function DataSourceOptionsTable() {
  const router = useRouter();
  const { mutateDefinitions } = useDefinitions();
  const eligibility = useDataSourceOptionEligibility();
  const { pricing, showPricing, pricingFootnote } =
    useDataSourceOptionPricing();

  const [managedWarehouseOpen, setManagedWarehouseOpen] = useState(false);
  const [newDataSourceFormOpen, setNewDataSourceFormOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const setUpActions: Record<DataSourceOptionKey, OptionAction> = {
    managed: {
      label: "Set up Managed Warehouse",
      variant: "solid",
      onClick: () => setManagedWarehouseOpen(true),
    },
    "event-forwarder": {
      label: "Set up Event Forwarder",
      variant: "outline",
      onClick: () => setNewDataSourceFormOpen(true),
    },
    custom: {
      label: "Set up Custom Data Source",
      variant: "outline",
      onClick: () => setNewDataSourceFormOpen(true),
    },
  };

  const getAction = (option: DataSourceOptionKey): OptionAction => {
    const availability = eligibility[option];
    switch (availability.status) {
      case "available":
        return setUpActions[option];
      case "already-set-up":
        return {
          label: `View ${OPTION_HEADS[option].name}`,
          variant: "outline",
          onClick: () =>
            router.push(`/datasources/${availability.datasourceId}`),
        };
      case "upgrade-required":
        return {
          label: "Upgrade to Pro",
          variant: "outline",
          icon: <GBPremiumBadge />,
          onClick: () => setUpgradeOpen(true),
        };
      case "unavailable":
        return { ...setUpActions[option], reason: availability.reason };
    }
  };

  const renderAction = (option: DataSourceOptionKey) => {
    const { label, variant, icon, onClick, reason } = getAction(option);
    return (
      <Tooltip
        body={reason}
        shouldDisplay={!!reason}
        style={{ display: "block" }}
      >
        <Button
          variant={variant}
          icon={icon ?? null}
          iconPosition="right"
          disabled={!!reason}
          style={{ width: "100%" }}
          onClick={onClick}
        >
          {label}
        </Button>
      </Tooltip>
    );
  };

  return (
    <>
      {managedWarehouseOpen ? (
        <ManagedWarehouseModal
          source="datasource-options"
          close={() => setManagedWarehouseOpen(false)}
        />
      ) : null}
      {newDataSourceFormOpen ? (
        <NewDataSourceForm
          source="datasource-options"
          showImportSampleData={false}
          onSuccess={async (id) => {
            await mutateDefinitions({});
            await router.push(`/datasources/${id}`);
          }}
          onCancel={() => setNewDataSourceFormOpen(false)}
        />
      ) : null}
      {upgradeOpen ? (
        <UpgradeModal
          close={() => setUpgradeOpen(false)}
          source="datasource-options"
          commercialFeature="events-forwarder"
        />
      ) : null}

      <Heading as="h2" size="md" mb="1">
        Choose How to Connect Your Data
      </Heading>
      <Text as="p" color="text-mid" mb="2">
        All three options use the same stats engine and experiment reports. You
        can add more Data Sources later.
      </Text>
      <SampleDataSourceLink />

      <Table
        variant="surface"
        layout="fixed"
        style={{ minWidth: 820, maxWidth: 1200 }}
      >
        <TableHeader>
          <TableRow align="start">
            <TableColumnHeader style={{ width: 190 }} />
            {OPTION_KEYS.map((option) => (
              <TableColumnHeader key={option} style={OPTION_COLUMN_STYLE}>
                <OptionHead
                  option={option}
                  upgradeRequired={
                    eligibility[option].status === "upgrade-required"
                  }
                />
              </TableColumnHeader>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {COMPARISON_ROWS.map((row) => (
            <TableRow key={row.label} align="center">
              <TableRowHeaderCell>
                <Text weight="medium">
                  {row.tooltip ? (
                    <LabelWithTooltip label={row.label} tooltip={row.tooltip} />
                  ) : (
                    row.label
                  )}
                </Text>
              </TableRowHeaderCell>
              {OPTION_KEYS.map((option) => (
                <TableCell key={option} style={OPTION_COLUMN_STYLE}>
                  <ComparisonCellContent {...row.cells[option]} />
                </TableCell>
              ))}
            </TableRow>
          ))}
          {showPricing ? (
            <TableRow align="center">
              <TableRowHeaderCell>
                <Text weight="medium">Event pricing</Text>
              </TableRowHeaderCell>
              {OPTION_KEYS.map((option) => {
                const { headline, detail } = pricing[option];
                return (
                  <TableCell key={option} style={OPTION_COLUMN_STYLE}>
                    <Text as="div" weight="semibold">
                      {headline}
                    </Text>
                    {detail ? (
                      <Text as="div" color="text-mid">
                        {detail}
                      </Text>
                    ) : null}
                  </TableCell>
                );
              })}
            </TableRow>
          ) : null}
          <TableRow align="start">
            <TableRowHeaderCell />
            {OPTION_KEYS.map((option) => (
              <TableCell key={option} style={OPTION_COLUMN_STYLE}>
                {renderAction(option)}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
      {pricingFootnote ? (
        <Text as="p" size="sm" color="text-mid" mt="3">
          {pricingFootnote}
        </Text>
      ) : null}
    </>
  );
}
