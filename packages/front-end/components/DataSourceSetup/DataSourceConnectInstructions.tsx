import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiArrowSquareOut, PiCheck, PiCopy } from "react-icons/pi";
import { DataSourceParams, DataSourceType } from "shared/types/datasource";
import { DocLink, DocSection } from "@/components/DocLink";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import {
  ConnectSetupKind,
  getDataSourceSetupInstructions,
  SetupInstructionStep,
} from "./getDataSourceSetupInstructions";

export type { ConnectSetupKind };

function CommandBlock({ code }: { code: string }) {
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });
  const label = copySuccess ? "Copied" : "Copy command";

  return (
    <Box mt="2" style={{ position: "relative" }}>
      <Box
        asChild
        style={{
          margin: 0,
          background: "var(--gray-a2)",
          border: "1px solid var(--gray-a5)",
          borderRadius: 6,
          padding: "12px 48px 12px 14px",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 12,
          lineHeight: 1.75,
          whiteSpace: "pre",
          overflowX: "auto",
          color: "var(--color-text-high)",
        }}
      >
        <pre>{code}</pre>
      </Box>
      {copySupported ? (
        <Tooltip content={label}>
          <IconButton
            type="button"
            variant="ghost"
            color="gray"
            size="1"
            aria-label={label}
            onClick={() => {
              performCopy(code);
            }}
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              // Match the command block, which is gray-a2 painted over the panel.
              backgroundColor: "var(--color-panel-solid)",
              backgroundImage:
                "linear-gradient(var(--gray-a2), var(--gray-a2))",
            }}
          >
            {copySuccess ? <PiCheck /> : <PiCopy />}
          </IconButton>
        </Tooltip>
      ) : null}
    </Box>
  );
}

function InstructionDescription({ step }: { step: SetupInstructionStep }) {
  const link = step.docLink;
  const placeholder = "{link}";
  if (!link || !step.description.includes(placeholder)) {
    return (
      <Text as="p" color="text-mid" m="0">
        {step.description}
      </Text>
    );
  }

  const [before, after] = step.description.split(placeholder);
  return (
    <Text as="p" color="text-mid" m="0">
      {before}
      <DocLink docSection={link.section} useRadix>
        {link.label}
      </DocLink>
      {after}
    </Text>
  );
}

function CodeNote({ note }: { note: string }) {
  const parts = note.split("`");
  return (
    <Text as="p" color="text-mid" mt="2" mb="0">
      {parts.map((part, i) =>
        i % 2 === 1 ? <code key={i}>{part}</code> : part,
      )}
    </Text>
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
      <Box mb="2" style={{ fontSize: 14, fontWeight: 500 }}>
        {step.title}
      </Box>
      <InstructionDescription step={step} />
      {displayCode ? (
        <>
          <CommandBlock code={displayCode} />
          {step.codeNote ? <CodeNote note={step.codeNote} /> : null}
        </>
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
