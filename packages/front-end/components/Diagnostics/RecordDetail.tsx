import { Box } from "@radix-ui/themes";
import Code from "@/components/SyntaxHighlighting/Code";
import Text from "@/ui/Text";

export interface RecordDetailProps {
  /** The whole record, flattened. */
  fields: Record<string, unknown>;
  title?: string;
}

export default function RecordDetail({
  fields,
  title = "Full record",
}: RecordDetailProps) {
  return (
    <Box
      p="3"
      style={{ background: "var(--gray-a2)", borderRadius: "var(--radius-3)" }}
    >
      <Text size="sm" weight="medium" as="div">
        {title}
      </Text>
      <Code
        code={JSON.stringify(fields, null, 2)}
        language="json"
        showLineNumbers={false}
        expandable
        collapsedLines={20}
      />
    </Box>
  );
}
