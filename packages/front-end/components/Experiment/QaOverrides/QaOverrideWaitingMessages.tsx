import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiWarningBold } from "react-icons/pi";
import { QaOverrideWaitingFeature } from "shared/types/experiment-qa-override";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import styles from "./QaOverrides.module.scss";

type WaitingCopy = {
  title: ReactNode;
  description: ReactNode;
  action: string;
  note: ReactNode;
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
        note: (
          <>
            {flag} is off in {environment}, so this override won&apos;t apply
            until the flag is on.
          </>
        ),
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
        note: (
          <>
            The experiment rule on {flag} is disabled in {environment}, so this
            override won&apos;t apply until the rule is enabled.
          </>
        ),
      };
    case "draft":
      return {
        title: "The experiment rule isn't published",
        description: <>It&apos;s in an unpublished draft of {flag}.</>,
        action: "Review and publish draft",
        note: (
          <>
            The experiment rule is in an unpublished draft of {flag}, so this
            override won&apos;t apply until the draft is published.
          </>
        ),
      };
    // A discarded draft leaves the flag without the rule, like a missing one.
    case "discarded":
    case "missing":
      return {
        title: <>{flag} has no rule for this experiment</>,
        description:
          "The flag isn't using this experiment, so there's nothing to override.",
        action: "Add experiment rule",
        note: (
          <>
            {flag} has no rule for this experiment, so this override won&apos;t
            apply until one is added.
          </>
        ),
      };
    case "archived":
      return {
        title: <>{flag} is archived</>,
        description: "Archived flags aren't sent to SDKs.",
        action: "Unarchive flag",
        note: (
          <>
            {flag} is archived, so this override won&apos;t apply until the flag
            is unarchived.
          </>
        ),
      };
  }
}

function fixHref({ featureId, draftVersion }: QaOverrideWaitingFeature) {
  const base = `/features/${featureId}`;
  return draftVersion !== undefined ? `${base}?v=${draftVersion}` : base;
}

export function QaOverrideWaitingNote({
  waitingOn,
  environment,
}: {
  waitingOn: QaOverrideWaitingFeature[];
  environment: string;
}) {
  return (
    <Flex direction="column" gap="1">
      {waitingOn.map((w) => (
        <Text as="p" size="sm" mb="0" key={w.featureId}>
          {waitingCopy(w, environment).note}{" "}
          <Link href={fixHref(w)} size="sm" weight="medium">
            Open {w.featureId} →
          </Link>
        </Text>
      ))}
    </Flex>
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
