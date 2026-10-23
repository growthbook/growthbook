import { ReactNode } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { SettingsCard } from "./SettingsSection";

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
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <Box>
      <Box mb="1">
        <Text as={htmlFor ? "label" : "div"} htmlFor={htmlFor} weight="medium">
          {label}
        </Text>
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
