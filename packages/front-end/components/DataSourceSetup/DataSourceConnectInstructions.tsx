import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut, PiCheckBold, PiCopyBold } from "react-icons/pi";
import { DataSourceParams, DataSourceType } from "shared/types/datasource";
import { DocLink, DocSection } from "@/components/DocLink";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import {
  ConnectSetupKind,
  getDataSourceSetupInstructions,
  SetupInstructionStep,
} from "./getDataSourceSetupInstructions";

export type { ConnectSetupKind };

function StepCopyButton({ code }: { code: string }) {
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });
  if (!copySupported) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      color="gray"
      icon={copySuccess ? <PiCheckBold /> : <PiCopyBold />}
      onClick={() => {
        performCopy(code);
      }}
    >
      {copySuccess ? "Copied" : "Copy"}
    </Button>
  );
}

function InstructionStepView({ step }: { step: SetupInstructionStep }) {
  const displayCode = step.code
    ? step.preserveCase
      ? step.code
      : step.code.toUpperCase()
    : undefined;

  return (
    <Box>
      <Flex align="center" gap="3" mb="2">
        <Box style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>
          {step.title}
        </Box>
        {displayCode ? <StepCopyButton code={displayCode} /> : null}
      </Flex>
      <Text as="p" color="text-mid" m="0">
        {step.description}
      </Text>
      {displayCode ? (
        <Box
          asChild
          mt="2"
          style={{
            margin: "8px 0 0",
            background: "var(--gray-a2)",
            border: "1px solid var(--gray-a5)",
            borderRadius: 6,
            padding: "12px 14px",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 12,
            lineHeight: 1.75,
            whiteSpace: "pre",
            overflowX: "auto",
            color: "var(--color-text-high)",
            textTransform: step.preserveCase ? "none" : "uppercase",
          }}
        >
          <pre>{displayCode}</pre>
        </Box>
      ) : null}
    </Box>
  );
}

export default function DataSourceConnectInstructions({
  type,
  displayName,
  docs,
  setup,
  params,
}: {
  type: DataSourceType;
  displayName: string;
  docs: DocSection;
  setup: ConnectSetupKind;
  params?: Partial<DataSourceParams>;
}) {
  const steps = getDataSourceSetupInstructions(type, setup, params);

  return (
    <Box
      asChild
      style={{
        background: "var(--color-panel-solid)",
        borderLeft: "1px solid var(--gray-a5)",
        height: "100%",
        minHeight: 0,
        overflowY: "auto",
        // Keep left/right padding visually equal when a scrollbar appears.
        scrollbarGutter: "stable",
        padding: "24px 24px 48px",
        boxSizing: "border-box",
      }}
    >
      <aside>
        <Heading as="h3" size="md" mb="1">
          Setup Instructions
        </Heading>
        <Text as="p" color="text-mid" mb="4">
          Updates as you fill in the form.
        </Text>
        <Flex direction="column" gap="5">
          {steps.map((step, i) => (
            <Flex key={`${step.title}-${i}`} gap="3" align="start">
              <Flex
                align="center"
                justify="center"
                flexShrink="0"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "var(--violet-a3)",
                  color: "var(--violet-11)",
                  fontSize: 12,
                  fontWeight: 600,
                  marginTop: 1,
                }}
              >
                {i + 1}
              </Flex>
              <Box style={{ flex: 1, minWidth: 0 }}>
                <InstructionStepView step={step} />
              </Box>
            </Flex>
          ))}
        </Flex>
        <Box mt="5">
          <DocLink docSection={docs} fallBackSection="datasources" useRadix>
            Read the full {displayName} guide <PiArrowSquareOut />
          </DocLink>
        </Box>
      </aside>
    </Box>
  );
}
