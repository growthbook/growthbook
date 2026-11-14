import { ReactNode, useRef } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Markdown from "@/components/Markdown/Markdown";
import { NamedRevision } from "@/components/Reviews/RevisionLabel";
import useIsOverflowing from "@/hooks/useIsOverflowing";
import Text from "@/ui/Text";
import type { RevisionFact } from "@/components/Features/revisionFacts";

const NOTES_MAX_HEIGHT = 100;
// Fits the longest label on one line, so the values share a left edge.
const LABEL_WIDTH = "96px";

// A label column and its value, like the experiment Setup page's rows.
function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Flex align="baseline" gap="3">
      <Box flexShrink="0" width={LABEL_WIDTH}>
        <Text weight="medium" color="text-high" whiteSpace="nowrap">
          {label}
        </Text>
      </Box>
      <Box flexGrow="1" minWidth="0" style={{ color: "var(--color-text-mid)" }}>
        {children}
      </Box>
    </Flex>
  );
}

// What a revision selector shows about a revision on hover.
export default function RevisionDetailsCard({
  version,
  title,
  badge,
  facts,
  comment,
}: {
  version: number;
  title?: string | null;
  badge: ReactNode;
  facts: RevisionFact[];
  comment?: string | null;
}) {
  const notes = useRef<HTMLDivElement>(null);
  const notesOverflow = useIsOverflowing(notes, NOTES_MAX_HEIGHT);

  return (
    <Flex direction="column" gap="3" style={{ width: 360 }}>
      <Flex align="center" justify="between" gap="3">
        <Text weight="semibold">
          <NamedRevision version={version} title={title} />
        </Text>
        {badge}
      </Flex>
      <Flex direction="column" gap="2">
        {facts.map(({ label, value }) => (
          <DetailRow key={label} label={label}>
            {value}
          </DetailRow>
        ))}
        {comment ? (
          <DetailRow label="Description">
            <Box
              className={notesOverflow ? "fade-mask-bottom-1rem" : undefined}
              style={{ maxHeight: NOTES_MAX_HEIGHT, overflow: "hidden" }}
            >
              <div ref={notes}>
                <Markdown>{comment}</Markdown>
              </div>
            </Box>
          </DetailRow>
        ) : null}
      </Flex>
    </Flex>
  );
}
