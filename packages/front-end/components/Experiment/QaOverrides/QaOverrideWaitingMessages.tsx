import { Fragment } from "react";
import { Flex } from "@radix-ui/themes";
import { QaOverrideWaitingFeature } from "shared/types/experiment-qa-override";
import { getQaOverrideWaitingMessages } from "shared/util";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

// The shared copy wraps flag and environment names in backticks.
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

/**
 * Why an override isn't applying yet, then what to do, with a link to each
 * Feature Flag involved. Used by the Waiting popover and the modal's callout.
 */
export default function QaOverrideWaitingMessages({
  waitingOn,
  environment,
}: {
  waitingOn: QaOverrideWaitingFeature[];
  environment: string;
}) {
  return (
    <Flex direction="column" gap="2">
      {getQaOverrideWaitingMessages(waitingOn, environment).map((m) => (
        <Flex key={m.reason} direction="column" gap="1">
          <Text as="p" size="sm" mb="0">
            <InlineCode text={m.state} /> <InlineCode text={m.action} />
          </Text>
          <Flex gap="3" wrap="wrap">
            {m.featureIds.map((id) => (
              <Link key={id} href={`/features/${id}`} size="sm">
                Open {id} →
              </Link>
            ))}
          </Flex>
        </Flex>
      ))}
    </Flex>
  );
}
