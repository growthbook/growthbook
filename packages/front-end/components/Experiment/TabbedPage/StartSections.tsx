import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { hasAttributeCondition } from "shared/experiments";
import { ReactNode } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import PremiumCallout from "@/ui/PremiumCallout";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import HoldoutTrafficBreakdown from "@/components/Holdout/HoldoutTrafficBreakdown";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { getNamespaceDisplayData } from "@/components/Features/NamespaceSelectorUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import { ReadOnlyChecklistRows } from "@/components/PreLaunchChecklist/PreLaunchChecklist";
import type { CheckListItem } from "@/components/PreLaunchChecklist/PreLaunchChecklistItems";
import { percentFormatter } from "./DecisionMakingSettings";
import { ServerChecklistItem } from "./startActions";
import { revisionHref } from "./draftPicks";
import { StartUpgrade } from "./useStartGate";
import { PendingDraftFailure } from "./useStartExperiment";

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

/** Label/value rows, such as when an experiment starts and ends. */
export function SummaryGrid({ children }: { children: ReactNode }) {
  return (
    <Grid columns="max-content minmax(0, 1fr)" gapX="4" gapY="2" align="start">
      {children}
    </Grid>
  );
}

export function SummaryRow({
  label,
  children,
  action = null,
}: {
  label: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <>
      <Text size="sm" color="text-mid">
        {label}
      </Text>
      <Flex justify="between" align="baseline" gap="3">
        <Text size="sm" color="text-high">
          {children}
        </Text>
        {action}
      </Flex>
    </>
  );
}

export function StartFailures({
  failures,
}: {
  failures: PendingDraftFailure[];
}) {
  if (!failures.length) return null;
  return (
    <Callout status="error" size="sm">
      <Text size="sm" weight="semibold" color="text-high">
        Linked Feature Flag drafts that could not be published
      </Text>
      <Flex direction="column" gap="2" mt="2">
        {failures.map((failure) => (
          <Flex
            key={`${failure.featureId}-${failure.revisionVersion}`}
            gap="2"
            align="baseline"
            wrap="wrap"
          >
            <Link
              href={revisionHref(failure.featureId, failure.revisionVersion)}
              target="_blank"
            >
              <Text size="sm" weight="semibold">
                {failure.featureId}
              </Text>
              <PiArrowSquareOut className="ml-1" />
            </Link>
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

export function TargetingSummaryRow({
  label,
  inline = false,
  children,
}: {
  label: string;
  // Short enough to sit beside its label.
  inline?: boolean;
  children: ReactNode;
}) {
  return (
    <Flex
      direction={inline ? "row" : "column"}
      gap={inline ? "2" : "1"}
      align={inline ? "baseline" : "stretch"}
    >
      <Text size="md" weight="semibold" color="text-high">
        {label}:
      </Text>
      <Box>{children}</Box>
    </Flex>
  );
}

/** A holdout's traffic and targeting as it will start. */
export function StartSummary({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const { namespaces } = useOrgSettings();
  const latestPhase = experiment.phases.at(-1);
  if (!latestPhase) return null;
  const { coverage: namespaceCoverage, name: namespaceName } =
    getNamespaceDisplayData(latestPhase.namespace, namespaces);

  return (
    <Flex direction="column" gap="4">
      {latestPhase.namespace?.enabled ? (
        <TargetingSummaryRow label="Namespace" inline>
          <Text>
            {percentFormatter.format(namespaceCoverage)} of {namespaceName}
          </Text>
        </TargetingSummaryRow>
      ) : null}
      <TargetingSummaryRow label="Traffic">
        <HoldoutTrafficBreakdown phase={latestPhase} />
      </TargetingSummaryRow>
      {hasAttributeCondition(latestPhase.condition) ? (
        <TargetingSummaryRow label="Attribute targeting">
          <ConditionDisplay condition={latestPhase.condition} />
        </TargetingSummaryRow>
      ) : null}
      {latestPhase.savedGroups?.length ? (
        <TargetingSummaryRow label="Saved Group targeting">
          <SavedGroupTargetingDisplay savedGroups={latestPhase.savedGroups} />
        </TargetingSummaryRow>
      ) : null}
    </Flex>
  );
}

const UPGRADE_REASONS: Record<StartUpgrade, string> = {
  "visual-editor":
    "This experiment contains AI Visual Editor changes, which require a paid plan.",
  redirects:
    "This experiment contains URL redirects, which require a paid plan.",
};

export function StartUpgradeCallout({
  upgrade,
}: {
  upgrade: StartUpgrade | null;
}) {
  if (!upgrade) return null;
  return (
    <PremiumCallout
      commercialFeature={upgrade}
      id="start-experiment-modal"
      size="sm"
    >
      {UPGRADE_REASONS[upgrade]}
    </PremiumCallout>
  );
}

/** What blocks a start the viewer can't bypass, read only. */
export function StartBlockers({
  items,
  upgrade,
}: {
  items: CheckListItem[];
  upgrade: StartUpgrade | null;
}) {
  return (
    <Flex direction="column" gap="2">
      <Text size="sm" weight="semibold" color="text-high">
        Resolve before starting
      </Text>
      {upgrade ? (
        <Text size="sm" color="text-mid">
          {UPGRADE_REASONS[upgrade]}
        </Text>
      ) : null}
      <ReadOnlyChecklistRows items={items} />
    </Flex>
  );
}
