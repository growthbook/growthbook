import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import type { BreadcrumbItem } from "@/ui/Breadcrumbs";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import UnsavedChangesBar from "@/components/GeneralSettings/UnsavedChangesBar";
import PageHead from "./PageHead";

export function SettingsPageHeader({
  title,
  description,
  actions,
  as = "h1",
  mb = "4",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h1" | "h2";
  mb?: "0" | "4";
}) {
  return (
    <Flex justify="between" align="start" gap="4" wrap="wrap" mb={mb}>
      <Box>
        <Heading
          as={as}
          size={as === "h1" ? "xl" : "lg"}
          mb={description ? "1" : "0"}
        >
          {title}
        </Heading>
        {description && (
          <Text as="p" color="text-mid" m="0">
            {description}
          </Text>
        )}
      </Box>
      {actions && (
        <Flex gap="2" align="center">
          {actions}
        </Flex>
      )}
    </Flex>
  );
}

export default function SettingsPage({
  title,
  description,
  actions,
  parent,
  breadcrumb,
  hideHeader,
  contentClassName,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  parent?: BreadcrumbItem;
  breadcrumb?: BreadcrumbItem[];
  hideHeader?: boolean;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <>
      <PageHead
        breadcrumb={
          breadcrumb ?? [
            { display: "Settings" },
            { display: "Organization" },
            ...(parent ? [parent] : []),
            { display: title },
          ]
        }
      />
      <Box className="container-fluid pagecontents" mb="4">
        {!hideHeader && (
          <SettingsPageHeader
            title={title}
            description={description}
            actions={actions}
          />
        )}
        <Box className={contentClassName} pb="5">
          {children}
          <UnsavedChangesBar />
        </Box>
      </Box>
    </>
  );
}

export function SettingsNoAccess({ title }: { title: string }) {
  return (
    <SettingsPage title={title}>
      <Callout status="error">
        You do not have access to view this page.
      </Callout>
    </SettingsPage>
  );
}
