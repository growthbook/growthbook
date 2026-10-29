import React, { FC, PropsWithChildren } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";

type ImportFromServiceCardProps = PropsWithChildren<{
  service: string;
  icon: string;
  accentColor: string;
  // Services with a self-serve importer link to their import page
  path?: string;
  // Services without one open a "request migration help" modal instead
  onRequest?: () => void;
}>;

export const ImportFromServiceCard: FC<ImportFromServiceCardProps> = ({
  icon,
  service,
  path,
  accentColor,
  onRequest,
  children,
}) => {
  return (
    <Box className="appbox" mb="0" p="4">
      <Flex align="center" gap="4">
        <Flex
          align="center"
          justify="center"
          flexShrink="0"
          width="40px"
          height="40px"
          style={{ backgroundColor: accentColor, borderRadius: 6 }}
        >
          <img
            src={`/images/3rd-party-logos/importing/icons/${icon}.svg`}
            width={26}
            alt={`${service} logo`}
          />
        </Flex>
        <Box flexGrow="1">
          <Heading as="h2" size="sm" mb="1">
            {service}
          </Heading>
          <Text as="p" color="text-mid" m="0">
            {children}
          </Text>
        </Box>
        <Box flexShrink="0">
          {path ? (
            <LinkButton href={`importing/${path}`}>
              Import from {service}
            </LinkButton>
          ) : (
            <Button variant="outline" onClick={() => onRequest?.()}>
              Get migration help
            </Button>
          )}
        </Box>
      </Flex>
    </Box>
  );
};
