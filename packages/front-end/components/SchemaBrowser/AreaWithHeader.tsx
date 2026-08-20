import { Box, Flex } from "@radix-ui/themes";

export default function AreaWithHeader({
  backgroundColor = "var(--color-panel-translucent)",
  children,
  header,
  hideHeader = false,
  borderless = false,
  headerStyles = {
    paddingLeft: "12px",
    paddingRight: "12px",
    paddingTop: "12px",
    paddingBottom: "12px",
    borderBottom: "1px solid var(--gray-a3)",
  },
}: {
  backgroundColor?: string;
  children: React.ReactNode;
  header: React.ReactNode;
  hideHeader?: boolean;
  borderless?: boolean;
  headerStyles?: React.CSSProperties;
}) {
  return (
    <Flex
      direction="column"
      height="100%"
      style={{
        border: borderless ? undefined : "1px solid var(--gray-a3)",
        borderRadius: borderless ? undefined : "var(--radius-4)",
        overflow: "hidden",
        backgroundColor,
      }}
    >
      {!hideHeader ? <Box style={headerStyles}>{header}</Box> : null}
      <Box flexGrow="1" style={{ overflowY: "auto" }}>
        {children}
      </Box>
    </Flex>
  );
}
