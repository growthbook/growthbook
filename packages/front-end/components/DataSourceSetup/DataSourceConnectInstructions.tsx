import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiArrowSquareOut, PiCheck, PiCopy } from "react-icons/pi";
import { DataSourceParams, DataSourceType } from "shared/types/datasource";
import type { DataRegion } from "shared/util";
import { DocLink, DocSection } from "@/components/DocLink";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useDataRegionOptions } from "@/services/dataRegions";
import { isCloud } from "@/services/env";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import type { EventForwarderDestination } from "./EventForwarderDestinationFields";
import type { SnowflakeKeyPair } from "./generateSnowflakeKeyPair";
import {
  ConnectSetupKind,
  getDataSourceSetupInstructions,
  SetupInstructionStep,
} from "./getDataSourceSetupInstructions";
import styles from "./DataSourceConnectInstructions.module.scss";

export type { ConnectSetupKind };

/**
 * `copyText` is what lands on the clipboard when it must differ from what is
 * shown, e.g. a query displayed with a masked password.
 */
function CommandBlock({ code, copyText }: { code: string; copyText?: string }) {
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
          fontFamily: "var(--code-font-family)",
          fontSize: 12,
          lineHeight: 1.75,
          // Wrap long lines in place of a horizontal scrollbar; a token only
          // breaks mid-word when it is wider than the pane on its own. The
          // copy button still copies the unwrapped text.
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
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
              performCopy(copyText ?? code);
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
        i % 2 === 1 ? (
          <Text key={i} as="span" mono color="text-high">
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

function InstructionStepView({ step }: { step: SetupInstructionStep }) {
  return (
    <Box>
      <Text as="p" weight="medium" mb="2">
        {step.title}
      </Text>
      <InstructionDescription step={step} />
      {step.code ? (
        <>
          <CommandBlock code={step.code} copyText={step.codeToCopy} />
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
  existing = false,
  savedParams = null,
  eventForwarderRegion = null,
  eventForwarderDestination = null,
  snowflakeKeyPair = null,
}: {
  type: DataSourceType;
  displayName: string;
  docs: DocSection;
  setup: ConnectSetupKind;
  params?: Partial<DataSourceParams>;
  /** Editing a saved connection. Affects defaults such as Snowflake's auth method. */
  existing?: boolean;
  /** The saved connection's params when editing, so the SQL can alter the existing user and repeat only the grants that changed. */
  savedParams?: Partial<DataSourceParams> | null;
  /** Null until the warehouse region is detected or chosen. Edit mode passes the saved region. */
  eventForwarderRegion?: DataRegion | null;
  /** The dataset/schema/catalog-schema chosen in the Event Destination fields, so write-access SQL grants the place GrowthBook will actually write to. */
  eventForwarderDestination?: EventForwarderDestination | null;
  /** Key pair GrowthBook generated for Snowflake, if the user asked for one. */
  snowflakeKeyPair?: SnowflakeKeyPair | null;
}) {
  const regionOptions = useDataRegionOptions();
  const steps = getDataSourceSetupInstructions(type, setup, params, {
    existing,
    saved: savedParams,
    cloud: isCloud(),
    eventForwarderRegions: eventForwarderRegion
      ? [eventForwarderRegion]
      : regionOptions.map((o) => o.value),
    eventForwarderDestination,
    snowflakeKeyPair,
  });

  return (
    <Box asChild className={styles.aside}>
      <aside>
        <Heading as="h3" size="md" mb="1">
          Setup Instructions
        </Heading>
        <Text as="p" color="text-mid" mb="4">
          Fill in the form first. The steps below update to match what you
          enter.
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
