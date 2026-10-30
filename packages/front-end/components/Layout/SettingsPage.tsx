import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import type { BreadcrumbItem } from "@/ui/Breadcrumbs";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import PageHead from "./PageHead";

export function SettingsPageHeader({
  title,
  description,
  actions,
  as = "h1",
  mb = "4",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h1" | "h2";
  mb?: "0" | "4";
  className?: string;
}) {
  return (
    <Flex
      justify="between"
      align="start"
      gap="4"
      wrap="wrap"
      mb={mb}
      className={className}
    >
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
  group = "organization",
  breadcrumb,
  hideHeader,
  headerClassName,
  contentClassName,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  parent?: BreadcrumbItem;
  // Which Settings nav group the page is reached from. "general" pages show
  // under Organization for roles that cannot see General.
  group?: "general" | "organization";
  breadcrumb?: BreadcrumbItem[];
  hideHeader?: boolean;
  headerClassName?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  const permissionsUtil = usePermissionsUtil();
  const root: BreadcrumbItem =
    group === "general" && permissionsUtil.canManageOrgSettings()
      ? { display: "General", href: "/settings" }
      : {
          display: "Organization",
          // Organization lands on Projects, so only link it for users who can open it.
          ...(permissionsUtil.canViewProjectsPage()
            ? { href: "/projects" }
            : {}),
        };
  return (
    <>
      <PageHead
        breadcrumb={
          breadcrumb ?? [root, ...(parent ? [parent] : []), { display: title }]
        }
      />
      <Box className="container-fluid pagecontents" mb="4">
        {!hideHeader && (
          <SettingsPageHeader
            title={title}
            description={description}
            actions={actions}
            className={headerClassName}
          />
        )}
        <Box className={contentClassName} pb="5">
          {children}
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
