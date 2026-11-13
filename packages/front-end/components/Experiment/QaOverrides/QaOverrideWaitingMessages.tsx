import { Fragment } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiWarningBold } from "react-icons/pi";
import { QaOverrideWaitingFeature } from "shared/types/experiment-qa-override";
import {
  QaOverrideWaitingMessage,
  getQaOverrideWaitingMessages,
} from "shared/util";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

// The shared copy wraps flag names in backticks.
function InlineCode({ text }: { text: string }) {
  return (
    <>
      {text
        .split("`")
        .map((part, i) =>
          i % 2 ? (
            <code key={i}>{part}</code>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          ),
        )}
    </>
  );
}

// Where the fix happens: the draft that needs publishing when there is one,
// otherwise the Feature Flag's page.
function fixHref(message: QaOverrideWaitingMessage): string {
  const base = `/features/${message.featureId}`;
  return message.draftVersion !== undefined
    ? `${base}?v=${message.draftVersion}`
    : base;
}

/**
 * The add/edit modal's note: one sentence per Feature Flag that isn't serving
 * the override yet, with a link to the flag. It doesn't block saving.
 */
export function QaOverrideWaitingNote({
  waitingOn,
  environment,
}: {
  waitingOn: QaOverrideWaitingFeature[];
  environment: string;
}) {
  return (
    <Flex direction="column" gap="1">
      {getQaOverrideWaitingMessages(waitingOn, environment).map((m) => (
        <Text as="p" size="sm" mb="0" key={m.featureId}>
          <InlineCode text={m.note} />{" "}
          <Link href={fixHref(m)} size="sm" weight="medium">
            Open {m.featureId} →
          </Link>
        </Text>
      ))}
    </Flex>
  );
}

/**
 * The "Not applied" popover: for each Feature Flag in the way, a status
 * header naming the problem, a line of detail, and the one action that fixes
 * it.
 */
export function QaOverrideWaitingPopoverContent({
  waitingOn,
  environment,
}: {
  waitingOn: QaOverrideWaitingFeature[];
  environment: string;
}) {
  return (
    // The popover has no padding of its own so the header can run edge to
    // edge; the rounding is here because the popover can't clip (it would
    // cut off its hover bridge).
    <Box
      style={{
        width: 320,
        borderRadius: "var(--radius-3)",
        overflow: "hidden",
      }}
    >
      {getQaOverrideWaitingMessages(waitingOn, environment).map((m) => (
        <Box key={m.featureId}>
          <Flex
            align="start"
            gap="2"
            style={{
              padding: "10px 14px",
              background: "var(--amber-a3)",
              borderBlock: "1px solid var(--amber-a4)",
            }}
          >
            <PiWarningBold
              size={16}
              color="var(--amber-11)"
              style={{ flexShrink: 0, marginTop: 2 }}
            />
            <Heading as="h4" size="xs" mb="0">
              <InlineCode text={m.title} />
            </Heading>
          </Flex>
          <Flex
            direction="column"
            gap="3"
            style={{ padding: "12px 14px 14px" }}
          >
            <Text as="p" size="sm" color="text-mid" mb="0">
              <InlineCode text={m.description} />
            </Text>
            <Flex justify="end">
              <Link href={fixHref(m)} size="sm" weight="medium">
                {m.action}
              </Link>
            </Flex>
          </Flex>
        </Box>
      ))}
    </Box>
  );
}
