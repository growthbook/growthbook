import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiWarningBold } from "react-icons/pi";
import { QaOverrideWaitingFeature } from "shared/types/experiment-qa-override";
import Heading from "@/ui/Heading";
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
        description: `The override starts applying as soon as the flag is on in ${environment}.`,
        action: "Turn on flag",
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
          "The flag isn't using this experiment, so there's nothing to override.",
        action: "Add experiment rule",
      };
    case "archived":
      return {
        title: <>{flag} is archived</>,
        description: "Archived flags aren't sent to SDKs.",
        action: "Unarchive flag",
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
  const flag = plural("the feature flag is", "the feature flags are");
  switch (reason) {
    case "draft":
      return `QA will be available once the feature flag ${plural("draft is", "drafts are")} published.`;
    case "disabled-env":
      return `QA will be available once ${flag} turned on in ${environment}.`;
    case "disabled-rule":
      return `QA will be available once the experiment ${plural("rule is", "rules are")} enabled in ${environment}.`;
    case "discarded":
    case "missing":
      return `QA will be available once ${plural("the feature flag uses", "the feature flags use")} this experiment.`;
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

export function QaOverrideWaitingPopoverContent({
  waitingOn,
  environment,
}: {
  waitingOn: QaOverrideWaitingFeature[];
  environment: string;
}) {
  return (
    <Box className={styles.waitingPopover}>
      {waitingOn.map((w) => {
        const copy = waitingCopy(w, environment);
        return (
          <Box key={w.featureId}>
            <Box className={styles.waitingHeader}>
              <PiWarningBold
                size={16}
                color="var(--amber-11)"
                style={{ flexShrink: 0, marginTop: 2 }}
              />
              <Heading as="h4" size="xs" mb="0">
                {copy.title}
              </Heading>
            </Box>
            <Box className={styles.waitingBody}>
              <Text as="p" size="sm" color="text-mid" mb="0">
                {copy.description}
              </Text>
              <Flex justify="end">
                <Link href={fixHref(w)} size="sm" weight="medium">
                  {copy.action}
                </Link>
              </Flex>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
