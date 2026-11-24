import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  ExperimentQaOverrideWithStatus,
  QaOverrideInvalidReason,
  QaOverrideWaitingFeature,
} from "shared/types/experiment-qa-override";
import Heading from "@/ui/Heading";
import { RadixStatusIcon } from "@/ui/HelperText";
import ModalWarningBanner from "@/components/Modal/ModalWarningBanner";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import styles from "./QaOverrides.module.scss";

type WaitingCopy = {
  title: ReactNode;
  description: ReactNode;
  action: string;
};

function waitingCopy(
  { featureId, reason }: QaOverrideWaitingFeature,
  environment: string,
): WaitingCopy {
  const flag = <code>{featureId}</code>;
  switch (reason) {
    case "disabled-env":
      return {
        title: (
          <>
            {flag} is off in {environment}
          </>
        ),
        description: `The override starts applying as soon as the Feature Flag is on in ${environment}.`,
        action: "Turn on Feature Flag",
      };
    case "disabled-rule":
      return {
        title: `The experiment rule is disabled in ${environment}`,
        description: (
          <>
            The rule on {flag} is switched off for {environment}.
          </>
        ),
        action: "Enable the rule",
      };
    case "draft":
      return {
        title: "The experiment rule isn't published",
        description: <>It&apos;s in an unpublished draft of {flag}.</>,
        action: "Review and publish draft",
      };
    // A discarded draft leaves the flag without the rule, like a missing one.
    case "discarded":
    case "missing":
      return {
        title: <>{flag} has no rule for this experiment</>,
        description:
          "The Feature Flag isn't using this experiment, so there's nothing to override.",
        action: "Add experiment rule",
      };
    case "archived":
      return {
        title: <>{flag} is archived</>,
        description: "Archived Feature Flags aren't sent to SDKs.",
        action: "Unarchive Feature Flag",
      };
  }
}

function fixHref({ featureId, draftVersion }: QaOverrideWaitingFeature) {
  const base = `/features/${featureId}`;
  return draftVersion !== undefined ? `${base}?v=${draftVersion}` : base;
}

type WaitingReason = QaOverrideWaitingFeature["reason"];

function waitingStatusText(
  reason: WaitingReason,
  count: number,
  environment: string,
): string {
  const plural = (one: string, many: string) => (count === 1 ? one : many);
  const flag = plural("the Feature Flag is", "the Feature Flags are");
  switch (reason) {
    case "draft":
      return `QA will be available once the Feature Flag ${plural("draft is", "drafts are")} published.`;
    case "disabled-env":
      return `QA will be available once ${flag} turned on in ${environment}.`;
    case "disabled-rule":
      return `QA will be available once the experiment ${plural("rule is", "rules are")} enabled in ${environment}.`;
    case "discarded":
    case "missing":
      return `QA will be available once ${plural("the Feature Flag uses", "the Feature Flags use")} this experiment.`;
    case "archived":
      return `QA will be available once ${flag} unarchived.`;
  }
}

// An unpublished flag draft is the normal path to QA, so it's info; anything
// else needs fixing first.
export function QaOverrideWaitingBanner({
  waitingOn,
  environment,
}: {
  waitingOn: QaOverrideWaitingFeature[];
  environment: string;
}) {
  const counts = new Map<WaitingReason, number>();
  for (const { reason } of waitingOn) {
    // Both leave the flag without the rule, so they share a line.
    const key = reason === "discarded" ? "missing" : reason;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const onlyDrafts = [...counts.keys()].every((r) => r === "draft");
  return (
    <ModalWarningBanner status={onlyDrafts ? "info" : "warning"}>
      {[...counts].map(([reason, count]) => (
        <div key={reason}>{waitingStatusText(reason, count, environment)}</div>
      ))}
    </ModalWarningBanner>
  );
}

function invalidCopy(reason: QaOverrideInvalidReason): {
  title: string;
  description: string;
} {
  switch (reason) {
    case "variation-removed":
      return {
        title: "The forced variation was deleted",
        description:
          "This override forces a variation that\u2019s no longer in the experiment. Pick another variation to use it again.",
      };
    case "no-matching-connection":
      return {
        title: "No SDK Connection to apply to",
        description:
          "The SDK Connections this override targets were deleted, archived or moved to another environment. Pick another SDK Connection, or remove the filter.",
      };
  }
}

type Problem = {
  key: string;
  title: ReactNode;
  description: ReactNode;
  action: ReactNode;
};

// Invalid reasons first: they need an edit, the rest clear up by themselves.
export function QaOverrideProblemsPopoverContent({
  override,
  onEdit,
}: {
  override: Pick<
    ExperimentQaOverrideWithStatus,
    "waitingOn" | "invalidReasons" | "environment"
  >;
  onEdit?: () => void;
}) {
  const problems: Problem[] = [
    ...override.invalidReasons.map((reason) => ({
      key: reason,
      ...invalidCopy(reason),
      action: onEdit ? (
        <Link onClick={onEdit} size="sm" weight="medium">
          Edit override
        </Link>
      ) : null,
    })),
    ...override.waitingOn.map((w) => {
      const copy = waitingCopy(w, override.environment);
      return {
        key: w.featureId,
        title: copy.title,
        description: copy.description,
        action: (
          <Link href={fixHref(w)} size="sm" weight="medium">
            {copy.action}
          </Link>
        ),
      };
    }),
  ];
  return (
    <Box className={styles.waitingPopover}>
      {problems.map((problem) => (
        <Box key={problem.key}>
          <Box className={styles.waitingHeader}>
            <Box className={styles.waitingIcon}>
              <RadixStatusIcon status="warning" size="md" />
            </Box>
            <Heading as="h4" size="xs" mb="0">
              {problem.title}
            </Heading>
          </Box>
          <Box className={styles.waitingBody}>
            <Text as="p" size="sm" color="text-mid" mb="0">
              {problem.description}
            </Text>
            {problem.action ? (
              <Flex justify="end">{problem.action}</Flex>
            ) : null}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
