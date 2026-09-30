import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { hasAttributeCondition } from "shared/experiments";
import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import PremiumCallout from "@/ui/PremiumCallout";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import {
  formatTrafficSplit,
  getHoldoutTrafficBreakdown,
} from "@/services/utils";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { getNamespaceDisplayData } from "@/components/Features/NamespaceSelectorUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import { ServerChecklistItem } from "./startActions";
import { StartUpgrade } from "./useStartGate";
import { PendingDraftFailure } from "./useStartExperiment";

// "needs-rebase" is the no-conflict case: the draft is merely behind live.
const PENDING_DRAFT_FAILURE_LABELS: Record<
  PendingDraftFailure["reason"],
  string
> = {
  "merge-conflict":
    "Merge conflict with live — open the draft to fix conflicts",
  "needs-rebase": "Behind live, no conflicts — open the draft and rebase",
  "needs-approval": "Awaiting approval",
  "publish-error": "Publish failed unexpectedly",
};

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export function StartFailures({
  failures,
  managedFeatureId,
}: {
  failures: PendingDraftFailure[];
  managedFeatureId: string | null;
}) {
  if (!failures.length) return null;
  return (
    <Callout status="error" size="sm">
      <Text size="sm" weight="semibold" color="text-high">
        {managedFeatureId
          ? "Variation values that could not be published"
          : "Linked Feature Flag drafts that could not be published"}
      </Text>
      <Flex direction="column" gap="2" mt="2">
        {failures.map((failure) => (
          <Flex
            key={`${failure.featureId}-${failure.revisionVersion}`}
            gap="2"
            align="baseline"
            wrap="wrap"
          >
            {/* The flag page refuses writes on a managed flag; the To Do
                links to where its values are resolved. */}
            {managedFeatureId === failure.featureId ? (
              <Text weight="semibold">Variation values</Text>
            ) : (
              <Link
                href={`/features/${failure.featureId}?v=${failure.revisionVersion}`}
                target="_blank"
              >
                <Text weight="semibold">{failure.featureId}</Text>
                <PiArrowSquareOut className="ml-1" />
              </Link>
            )}
            <Text size="sm" color="text-mid">
              {PENDING_DRAFT_FAILURE_LABELS[failure.reason]}
            </Text>
          </Flex>
        ))}
      </Flex>
    </Callout>
  );
}

/** The To Do items the server refused the last start on, as it put them. */
export function StartChecklistFailures({
  items,
}: {
  items: ServerChecklistItem[];
}) {
  if (!items.length) return null;
  const blocking = items.some((item) => item.hardBlock);
  return (
    <Callout status={blocking ? "error" : "warning"} size="sm">
      <Text size="sm" weight="semibold" color="text-high">
        {blocking ? "Must resolve" : "Incomplete To Do items"}
      </Text>
      <Flex direction="column" gap="2" mt="2">
        {items.map((item, i) => (
          <Text key={`${item.key}:${i}`} size="sm" color="text-mid">
            {item.reason}
          </Text>
        ))}
      </Flex>
    </Callout>
  );
}

export type StartSummaryRow = {
  key: string;
  label: string;
  value: ReactNode;
  // Short enough to sit beside its label.
  inline: boolean;
};

/** Traffic and targeting as they will start. Empty before the first phase. */
export function useStartSummaryRows(
  experiment: ExperimentInterfaceStringDates,
): StartSummaryRow[] {
  const { namespaces } = useOrgSettings();
  const latestPhase = experiment.phases?.[experiment.phases.length - 1];
  const { coverage: namespaceCoverage, name: namespaceName } =
    getNamespaceDisplayData(latestPhase?.namespace, namespaces);
  if (!latestPhase) return [];

  const isHoldout = experiment.type === "holdout";
  const isBandit = experiment.type === "multi-armed-bandit";
  const holdoutTraffic = getHoldoutTrafficBreakdown(latestPhase);
  const rows: StartSummaryRow[] = [];
  if (latestPhase.namespace?.enabled) {
    rows.push({
      key: "namespace",
      label: "Namespace",
      inline: true,
      value: (
        <Text>
          {percentFormatter.format(namespaceCoverage)} of {namespaceName}
        </Text>
      ),
    });
  }
  rows.push({
    key: "traffic",
    label: "Traffic",
    inline: !isHoldout,
    value: isHoldout ? (
      <Flex direction="column" gap="1">
        <Text>{holdoutTraffic.inHoldoutPercent}% in holdout</Text>
        <Text>
          {holdoutTraffic.forMeasurementPercent}% not in holdout (for
          measurement)
        </Text>
        <Text>
          {holdoutTraffic.notForMeasurementPercent}% not in holdout (not for
          measurement)
        </Text>
      </Flex>
    ) : (
      <Text>
        {Math.floor(latestPhase.coverage * 100)}% included
        {!isBandit && (
          <>, {formatTrafficSplit(latestPhase.variationWeights, 2)} split</>
        )}
      </Text>
    ),
  });
  if (hasAttributeCondition(latestPhase.condition)) {
    rows.push({
      key: "attributeTargeting",
      label: "Attribute targeting",
      inline: false,
      value: <ConditionDisplay condition={latestPhase.condition} />,
    });
  }
  if (latestPhase.savedGroups?.length) {
    rows.push({
      key: "savedGroupTargeting",
      label: "Saved Group targeting",
      inline: false,
      value: (
        <SavedGroupTargetingDisplay savedGroups={latestPhase.savedGroups} />
      ),
    });
  }
  if (latestPhase.prerequisites?.length && !isHoldout) {
    rows.push({
      key: "prerequisites",
      label: "Prerequisites",
      inline: false,
      value: <ConditionDisplay prerequisites={latestPhase.prerequisites} />,
    });
  }
  return rows;
}

export function StartSummary({
  experiment,
  extraRows = [],
}: {
  experiment: ExperimentInterfaceStringDates;
  extraRows?: StartSummaryRow[];
}) {
  const rows = [...useStartSummaryRows(experiment), ...extraRows];
  if (!rows.length) return null;
  return (
    <Flex direction="column" gap="4">
      {rows.map((row) => (
        <Flex
          key={row.key}
          direction={row.inline ? "row" : "column"}
          gap={row.inline ? "2" : "1"}
          align={row.inline ? "baseline" : "stretch"}
        >
          <Text size="md" weight="semibold" color="text-high">
            {row.label}:
          </Text>
          <Box>{row.value}</Box>
        </Flex>
      ))}
    </Flex>
  );
}

export function StartUpgradeCallout({
  upgrade,
}: {
  upgrade: StartUpgrade | null;
}) {
  if (upgrade === "visual-editor") {
    return (
      <PremiumCallout
        commercialFeature="visual-editor"
        id="start-experiment-modal"
      >
        This experiment contains visual editor changes, which require a paid
        plan.
      </PremiumCallout>
    );
  }
  if (upgrade === "redirects") {
    return (
      <PremiumCallout commercialFeature="redirects" id="start-experiment-modal">
        This experiment contains URL redirects, which require a paid plan.
      </PremiumCallout>
    );
  }
  return null;
}
