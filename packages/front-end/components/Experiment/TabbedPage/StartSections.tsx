import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { hasAttributeCondition } from "shared/experiments";
import { isManagedByExperiment } from "shared/util";
import { ReactNode } from "react";
import { Box, Flex, type AvatarProps } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import PremiumCallout from "@/ui/PremiumCallout";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Avatar from "@/ui/Avatar";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
import Frame from "@/ui/Frame";
import {
  formatTrafficSplit,
  getHoldoutTrafficBreakdown,
} from "@/services/utils";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { getNamespaceDisplayData } from "@/components/Features/NamespaceSelectorUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import {
  ICON_PROPERTIES,
  LINKED_CHANGE_CONTAINER_PROPERTIES,
  type LinkedChange,
} from "@/components/Experiment/LinkedChanges/constants";
import { ManagedFlagName } from "@/components/Experiment/ManagedFlagName";
import { PendingDraftFailure } from "./useStartExperiment";
import { StartUpgrade } from "./useStartGate";
import { ServerChecklistItem } from "./startActions";

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

/** The experiment's own flag, when it is the only linked Feature Flag. */
function soleManagedFeature(
  experiment: Pick<ExperimentInterfaceStringDates, "id">,
  linkedFeatures: LinkedFeatureInfo[],
): LinkedFeatureInfo | null {
  return linkedFeatures.length === 1 &&
    linkedFeatures[0].feature &&
    isManagedByExperiment(linkedFeatures[0].feature, experiment.id)
    ? linkedFeatures[0]
    : null;
}

export function StartFailures({
  failures,
  managedFeatureId,
  onReviewValues,
}: {
  failures: PendingDraftFailure[];
  managedFeatureId: string | null;
  // The flag page refuses writes on a managed flag; its values are resolved
  // in the experiment's review.
  onReviewValues: (() => void) | null;
}) {
  if (!failures.length) return null;
  return (
    <Callout status="error">
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
            {managedFeatureId === failure.featureId && onReviewValues ? (
              <Link onClick={onReviewValues}>
                <Text weight="semibold">Review changes</Text>
              </Link>
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
    <Callout status={blocking ? "error" : "warning"}>
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
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const rows = useStartSummaryRows(experiment);
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

function LinkedChangeSection({
  type,
  count,
  countLabel,
  children,
}: {
  type: LinkedChange;
  count: number;
  countLabel?: string;
  children: ReactNode;
}) {
  const { component: Icon, radixColor } = ICON_PROPERTIES[type];
  const header = LINKED_CHANGE_CONTAINER_PROPERTIES[type].header;
  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="2">
        <Avatar
          radius="small"
          color={radixColor as AvatarProps["color"]}
          size="md"
          variant="soft"
        >
          <Icon />
        </Avatar>
        <Text weight="semibold" color="text-high">
          {countLabel ?? count} {count > 1 ? header : header.slice(0, -1)}
        </Text>
      </Flex>
      <Box pl="7">{children}</Box>
    </Flex>
  );
}

const MAX_VISIBLE_ENV_BADGES = 2;

function EnvironmentBadges({ environments }: { environments: string[] }) {
  const visible = environments.slice(0, MAX_VISIBLE_ENV_BADGES);
  const hidden = environments.slice(MAX_VISIBLE_ENV_BADGES);
  return (
    <Flex gap="2" align="center" flexShrink="0">
      {visible.map((env) => (
        <Badge
          key={env}
          color="amber"
          variant="soft"
          radius="full"
          label={`+ ${env}`}
        />
      ))}
      {hidden.length > 0 && (
        <Tooltip content={hidden.join(", ")} side="top">
          <Badge
            color="amber"
            variant="soft"
            radius="full"
            label={`+ ${hidden.length}`}
          />
        </Tooltip>
      )}
    </Flex>
  );
}

/** What starting turns on: linked Feature Flags, Visual Editor pages, redirects. */
export function LinkedChangesSummary({
  experiment,
  linkedFeatures,
  visualChangesets,
  urlRedirects,
  scheduledInFuture,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  scheduledInFuture: boolean;
}) {
  if (
    !linkedFeatures.length &&
    !visualChangesets.length &&
    !urlRedirects.length
  ) {
    return null;
  }
  // The experiment owns this flag, so it is not a "linked" change: name it.
  const managedFeature = soleManagedFeature(experiment, linkedFeatures);
  const managedFlagIsWholeChange =
    !!managedFeature && !visualChangesets.length && !urlRedirects.length;
  const featuresEnablingEnvsCount = linkedFeatures.filter(
    (f) => !!f.environmentsToEnable?.length,
  ).length;

  return (
    <>
      <Text weight="semibold" color="text-high">
        {managedFlagIsWholeChange
          ? scheduledInFuture
            ? "This managed Feature Flag will activate at the scheduled time:"
            : "This managed Feature Flag will activate:"
          : scheduledInFuture
            ? "Linked changes will activate at the scheduled time."
            : "Linked changes will activate. Users will see experiment variations immediately."}
      </Text>
      <Flex direction="column" gap="4" mt="3">
        {managedFeature?.feature ? (
          <ManagedFlagName featureId={managedFeature.feature.id} />
        ) : (
          linkedFeatures.length > 0 && (
            <LinkedChangeSection
              type="feature-flag"
              count={linkedFeatures.length}
            >
              {featuresEnablingEnvsCount > 0 && (
                <Callout status="warning" mb="3">
                  Starting this experiment will enable{" "}
                  {featuresEnablingEnvsCount} Feature Flag
                  {featuresEnablingEnvsCount === 1 ? "" : "s"} in environments
                  where {featuresEnablingEnvsCount === 1 ? "it is" : "they are"}{" "}
                  currently off.
                </Callout>
              )}
              <Flex direction="column" gap="2">
                {linkedFeatures.map((info) =>
                  info.feature?.id ? (
                    <Frame key={info.feature.id} px="3" py="3" mb="0">
                      <Flex align="center" justify="between" gap="3">
                        <Link
                          href={`/features/${info.feature.id}`}
                          target="_blank"
                          style={{ minWidth: 0 }}
                        >
                          <Flex align="center" gap="1" minWidth="0">
                            <Text
                              weight="semibold"
                              truncate
                              title={info.feature.id}
                            >
                              {info.feature.id}
                            </Text>
                            <PiArrowSquareOut style={{ flexShrink: 0 }} />
                          </Flex>
                        </Link>
                        {!!info.environmentsToEnable?.length && (
                          <EnvironmentBadges
                            environments={info.environmentsToEnable}
                          />
                        )}
                      </Flex>
                    </Frame>
                  ) : null,
                )}
              </Flex>
            </LinkedChangeSection>
          )
        )}
        {visualChangesets.length > 0 && (
          <LinkedChangeSection
            type="visual-editor"
            count={visualChangesets.length}
            countLabel={`${visualChangesets.length} Page${
              visualChangesets.length === 1 ? "" : "s"
            } with`}
          >
            <Flex wrap="wrap" gap="3">
              {visualChangesets.map((vc) =>
                vc.editorUrl ? (
                  <Link key={vc.id} href={vc.editorUrl} target="_blank">
                    <Text weight="semibold">{vc.editorUrl}</Text>
                    <PiArrowSquareOut className="ml-1" />
                  </Link>
                ) : null,
              )}
            </Flex>
          </LinkedChangeSection>
        )}
        {urlRedirects.length > 0 && (
          <LinkedChangeSection type="redirects" count={urlRedirects.length}>
            <Flex wrap="wrap" gap="3">
              {urlRedirects.map((r) => (
                <Link key={r.id} href={r.urlPattern} target="_blank">
                  <Text weight="semibold">{r.urlPattern}</Text>
                  <PiArrowSquareOut className="ml-1" />
                </Link>
              ))}
            </Flex>
          </LinkedChangeSection>
        )}
      </Flex>
    </>
  );
}
