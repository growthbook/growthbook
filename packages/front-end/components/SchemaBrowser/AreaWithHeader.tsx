import { Box, Flex } from "@radix-ui/themes";

export default function AreaWithHeader({
  backgroundColor = "var(--color-panel-translucent)",
  children,
  header,
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
  headerStyles?: React.CSSProperties;
}) {
  return (
    <Flex
      direction="column"
      height="100%"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        overflow: "hidden",
        backgroundColor,
      }}
    >
      <Box style={headerStyles}>{header}</Box>
      <Box flexGrow="1" style={{ overflowY: "auto" }}>
        {children}
      </Box>
    </Flex>
  );
}
