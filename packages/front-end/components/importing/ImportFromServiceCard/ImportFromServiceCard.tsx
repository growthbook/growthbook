import React, { FC, PropsWithChildren } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";

type ImportFromServiceCardProps = PropsWithChildren<{
  service: string;
  icon: string;
  // Logos with black or white parts ship an `${icon}-dark.svg` for dark mode
  hasDarkIcon: boolean;
  // Services with a self-serve importer link to their import page
  path?: string;
  // Services without one open a "request migration help" modal instead
  onRequest?: () => void;
}>;

// One row in a stacked list; the parent draws the outer border.
export const ImportFromServiceCard: FC<ImportFromServiceCardProps> = ({
  icon,
  service,
  path,
  hasDarkIcon,
  onRequest,
  children,
}) => {
  const { theme } = useAppearanceUITheme();
  const iconFile = hasDarkIcon && theme === "dark" ? `${icon}-dark` : icon;

  return (
    <Flex align="center" gap="4" py="3" px="4">
      <Flex
        align="center"
        justify="center"
        flexShrink="0"
        width="36px"
        height="36px"
        style={{
          backgroundColor: "var(--color-panel-solid)",
          border: "1px solid var(--gray-a5)",
          borderRadius: 6,
        }}
      >
        <img
          src={`/images/3rd-party-logos/importing/icons/${iconFile}.svg`}
          width={24}
          height={24}
          style={{ objectFit: "contain" }}
          alt={`${service} logo`}
        />
      </Flex>
      <Box flexGrow="1">
        <Heading as="h3" size="sm" mb="1">
          {service}
        </Heading>
        <Text as="p" color="text-mid" m="0">
          {children}
        </Text>
      </Box>
      {/* One shared width keeps the description column even down the stack. */}
      <Flex flexShrink="0" minWidth="130px" justify="end">
        {/* Short visible labels; the accessible name carries the service. */}
        {path ? (
          <LinkButton
            href={`importing/${path}`}
            aria-label={`Import from ${service}`}
          >
            Import
          </LinkButton>
        ) : (
          <Button
            variant="outline"
            aria-label={`Get help migrating from ${service}`}
            onClick={() => onRequest?.()}
          >
            Get help
          </Button>
        )}
      </Flex>
    </Flex>
  );
};
