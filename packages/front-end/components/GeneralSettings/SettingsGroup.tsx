import { ReactNode } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { SettingsCard } from "./SettingsSection";
import { useOptionalSettingsForm } from "./SettingsFormProvider";
import styles from "./SettingsSection.module.scss";

export function SettingsGroup({
  id,
  title,
  description,
  badge,
  keywords,
  children,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  badge?: string;
  keywords?: string;
  children: ReactNode;
}) {
  return (
    <SettingsCard id={id} keywords={keywords}>
      <Frame mb="3" p={{ initial: "4", md: "5" }}>
        <Grid
          columns={{ initial: "1", md: "220px 1fr" }}
          gap={{ initial: "3", md: "7" }}
        >
          <Flex direction="column" gap="2">
            <Flex align="center" gap="2" wrap="wrap">
              <Heading as="h3" size="sm" m="0">
                {title}
              </Heading>
              {badge && <Badge label={badge} color="gray" variant="soft" />}
            </Flex>
            {description && (
              <Text as="p" size="sm" color="text-mid" m="0">
                {description}
              </Text>
            )}
          </Flex>
          <Flex direction="column" gap="4" minWidth="0">
            {children}
          </Flex>
        </Grid>
      </Frame>
    </SettingsCard>
  );
}

// Without `htmlFor` the label is a plain heading, since a <label> needs a control.
export function SettingsField({
  label,
  help,
  htmlFor,
  name,
  action,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  htmlFor?: string;
  // Form paths this field edits, to mark it while unsaved.
  name?: string | string[];
  // Shown at the right of the label row.
  action?: ReactNode;
  children: ReactNode;
}) {
  const isFieldDirty = useOptionalSettingsForm()?.isFieldDirty;
  const dirty = !!isFieldDirty && [name ?? []].flat().some(isFieldDirty);
  return (
    <Box>
      {/* Bootstrap gives labels a 0.5rem bottom margin; the design wants 2px. */}
      <Box mb="2px" position="relative">
        {dirty && (
          <span className={styles.fieldDot} role="img" aria-label="Unsaved" />
        )}
        <Flex align="center" justify="between" gap="3">
          <Text
            as={htmlFor ? "label" : "div"}
            htmlFor={htmlFor}
            weight="medium"
            m="0"
          >
            {label}
          </Text>
          {action}
        </Flex>
      </Box>
      {help && (
        <Text as="p" size="sm" color="text-mid" mb="2">
          {help}
        </Text>
      )}
      {children}
    </Box>
  );
}

// Marks a checkbox or other control whose setting has an unsaved change.
export function UnsavedMark({
  name,
  dirty,
  children,
}: {
  name?: string | string[];
  dirty?: boolean;
  children: ReactNode;
}) {
  const isFieldDirty = useOptionalSettingsForm()?.isFieldDirty;
  const show =
    dirty ?? (!!isFieldDirty && [name ?? []].flat().some(isFieldDirty));
  return (
    <Box position="relative">
      {show && (
        <span className={styles.checkDot} role="img" aria-label="Unsaved" />
      )}
      {children}
    </Box>
  );
}

export function SettingsSubheading({ children }: { children: ReactNode }) {
  return (
    <Text
      as="div"
      size="sm"
      weight="semibold"
      color="text-mid"
      textTransform="uppercase"
      mt="1"
    >
      {children}
    </Text>
  );
}
