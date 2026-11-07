import { ReactNode, useId, useState } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import MarkdownInput from "@/components/Markdown/MarkdownInput";

export default function AttributeFormLayout({
  children,
  panel,
}: {
  children: ReactNode;
  panel: ReactNode;
}) {
  return (
    <Grid columns={{ initial: "1fr", md: "minmax(0, 1fr) 380px" }} gap="6">
      <Flex direction="column" gap="5" style={{ minWidth: 0 }}>
        {children}
      </Flex>
      <Flex
        direction="column"
        gap="5"
        p="4"
        style={{
          alignSelf: "start",
          position: "sticky",
          top: 0,
          minWidth: 0,
          background: "var(--gray-a2)",
          border: "1px solid var(--gray-a4)",
          borderRadius: "var(--radius-3)",
        }}
      >
        {panel}
      </Flex>
    </Grid>
  );
}

// Starts as a link unless there's already a description, so an empty one
// doesn't take up the space of a full editor.
export function DescriptionField({
  value,
  setValue,
  placeholder,
}: {
  value: string;
  setValue: (value: string) => void;
  placeholder: string;
}) {
  const id = useId();
  const [hadValue] = useState(!!value);
  const [open, setOpen] = useState(hadValue);

  if (!open) {
    return (
      <Box>
        <Link onClick={() => setOpen(true)}>
          <Flex align="center" gap="1">
            <PiPlus />
            <Text weight="medium">Add a description</Text>
          </Flex>
        </Link>
      </Box>
    );
  }
  return (
    <Flex direction="column" gap="1">
      <Text as="label" htmlFor={id} weight="semibold">
        Description
      </Text>
      <MarkdownInput
        id={id}
        value={value}
        setValue={setValue}
        placeholder={placeholder}
        autofocus={!hadValue}
        showButtons={false}
      />
    </Flex>
  );
}
