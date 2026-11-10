import { ReactNode, useId, useState } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import {
  SDKAttributeFormat,
  SDKAttributeType,
} from "shared/types/organization";
import { PiCaretDown, PiCaretRight, PiInfo, PiPlus } from "react-icons/pi";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Checkbox from "@/ui/Checkbox";
import { Select, SelectItem } from "@/ui/Select";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { AttributeRefEntry } from "@/hooks/useAttributeReferences";
import SDKCapabilityWarning from "./SDKCapabilityWarning";
import AttributeReferencesList from "./AttributeReferencesList";

export const ATTRIBUTE_DATA_TYPES: {
  value: SDKAttributeType;
  label: string;
  help: string;
}[] = [
  { value: "boolean", label: "Boolean", help: "true or false" },
  { value: "number", label: "Number", help: "Floats or integers" },
  { value: "string", label: "String", help: "Freeform text" },
  {
    value: "enum",
    label: "Enum",
    help: "For a small list of pre-defined values",
  },
  {
    value: "secureString",
    label: "Secure string",
    help: "Freeform text; values hashed before passing to the SDK",
  },
  {
    value: "number[]",
    label: "Array of numbers",
    help: "Useful for multiple numeric values",
  },
  {
    value: "string[]",
    label: "Array of strings",
    help: 'Useful for things like "tags"',
  },
  {
    value: "secureString[]",
    label: "Array of secure strings",
    help: "Useful for passing multiple values securely",
  },
];

export const IDENTIFIER_DATA_TYPES: SDKAttributeType[] = [
  "string",
  "number",
  "secureString",
];

export function DataTypeField({
  value,
  setValue,
  options,
}: {
  value: SDKAttributeType;
  setValue: (value: SDKAttributeType) => void;
  options: typeof ATTRIBUTE_DATA_TYPES;
}) {
  return (
    <Flex direction="column" gap="2">
      <Select
        label="Data type"
        value={value}
        setValue={(v) =>
          setValue(options.find((d) => d.value === v)?.value ?? "string")
        }
      >
        {options.map((d) => (
          <SelectItem key={d.value} value={d.value}>
            {d.label}
          </SelectItem>
        ))}
      </Select>
      <Text size="sm" color="text-mid">
        {options.find((d) => d.value === value)?.help}
      </Text>
      {isSecureDatatype(value) && <SecureStringHelp />}
    </Flex>
  );
}

export function isSecureDatatype(datatype: SDKAttributeType | undefined) {
  return datatype === "secureString" || datatype === "secureString[]";
}

function SecureStringHelp() {
  return (
    <Text size="sm" color="text-mid">
      <PremiumTooltip
        commercialFeature="hash-secure-attributes"
        tipPosition="bottom"
        // Shrinks the hover target to the text, so the arrow points at it.
        style={{ display: "inline-block" }}
        body={
          <>
            <p>
              Feature targeting conditions referencing <code>secureString</code>{" "}
              attributes will be anonymized via SHA-256 hashing. When evaluating
              feature flags in a public or insecure environment (such as a
              browser), hashing provides an additional layer of security through
              obfuscation. This allows you to target users based on sensitive
              attributes.
            </p>
            <p>
              You must enable this feature in your SDK Connection for it to take
              effect.
            </p>
            <HelperText status="warning" size="sm">
              When using an insecure environment, do not rely exclusively on
              hashing as a means of securing highly sensitive data. Hashing is
              an obfuscation technique that makes it very difficult, but not
              impossible, to extract sensitive data.
            </HelperText>
          </>
        }
      >
        How do secure attributes work? <PiInfo />
      </PremiumTooltip>
    </Text>
  );
}

export const STRING_FORMATS: {
  value: SDKAttributeFormat;
  label: string;
  example: string;
}[] = [
  { value: "version", label: "Version string", example: "1.2.3" },
  { value: "date", label: "Date string (ISO)", example: "2026-01-31" },
  {
    value: "isoCountryCode",
    label: "ISO country code (2 digit)",
    example: "US",
  },
];
// Select can't hold an empty value, so "no format" gets its own.
const NO_FORMAT = "none";

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

export function StringFormatField({
  value,
  setValue,
}: {
  value: SDKAttributeFormat;
  setValue: (value: SDKAttributeFormat) => void;
}) {
  return (
    <Flex direction="column" gap="2">
      <Select
        label="String format"
        value={value || NO_FORMAT}
        setValue={(v) =>
          setValue(STRING_FORMATS.find((f) => f.value === v)?.value ?? "")
        }
      >
        <SelectItem value={NO_FORMAT}>None</SelectItem>
        {STRING_FORMATS.map((f) => (
          <SelectItem key={f.value} value={f.value}>
            {f.label}
          </SelectItem>
        ))}
      </Select>
      <Text size="sm" color="text-mid">
        Changes the targeting UI and string comparison logic.
      </Text>
      {value === "version" && (
        <SDKCapabilityWarning
          capability="semverTargeting"
          someMessage="Some of your SDK Connections do not support version string comparisons. Targeting conditions using this attribute may not work correctly for those connections."
          noneMessage="None of your SDK Connections support version string comparisons. Do not use this format as it will break targeting conditions based on this attribute."
        />
      )}
    </Flex>
  );
}

export function AdvancedSettings({
  disableEqualityConditions,
  setDisableEqualityConditions,
}: {
  disableEqualityConditions: boolean;
  setDisableEqualityConditions: (value: boolean) => void;
}) {
  // Open when the setting is already on, so it isn't hidden.
  const [open, setOpen] = useState(disableEqualityConditions);
  return (
    <Flex direction="column" gap="3">
      <Box>
        <Link aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Flex align="center" gap="1">
            {open ? <PiCaretDown /> : <PiCaretRight />}
            <Text weight="medium">Advanced</Text>
          </Flex>
        </Link>
      </Box>
      {open && (
        <Checkbox
          label="Disable equality comparisons"
          description="This prevents users from targeting with exact string matches. Only regex and less than/greater than will be allowed. Useful for PII."
          value={disableEqualityConditions}
          setValue={setDisableEqualityConditions}
        />
      )}
    </Flex>
  );
}

export function RenameWarning({
  references,
  hasJsonManagedWarehouse,
  secure,
  identifier = false,
}: {
  references?: AttributeRefEntry;
  hasJsonManagedWarehouse: boolean;
  secure: boolean;
  identifier?: boolean;
}) {
  const noun = identifier ? "identifier" : "attribute";
  const refCount = references
    ? references.features.length +
      references.experiments.length +
      references.savedGroups.length
    : 0;
  return (
    <>
      <Callout status="warning">
        Be careful changing the {noun} name. Any existing{" "}
        {identifier
          ? "experiments, rules and targeting conditions"
          : "targeting conditions"}{" "}
        that use this {noun} will NOT be updated automatically and will still
        reference the old name.
        {secure && (
          <Box mt="2">
            Because this is a secure string, conditions that still use the old
            name will no longer be hashed, so their values appear in plain text
            in the SDK payload.
          </Box>
        )}
        {hasJsonManagedWarehouse && (
          <Box mt="2">
            Renaming doesn&apos;t migrate historical data. Events already sent
            under the old name keep that name in the Managed Warehouse and will
            read as null for this {noun}; only events your SDK sends under the
            new name will populate it going forward.
          </Box>
        )}
      </Callout>
      {references && refCount > 0 && (
        <AttributeReferencesList
          features={references.features}
          experiments={references.experiments}
          conditionGroups={references.savedGroups}
          collapsed
        />
      )}
    </>
  );
}
