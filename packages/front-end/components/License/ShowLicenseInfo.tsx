import React, { FC, useState } from "react";
import { date } from "shared/dates";
import { Box, Flex, Separator } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import DataList, { DataListItem } from "@/ui/DataList";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import { useUser } from "@/services/UserContext";
import EditLicenseModal from "@/components/Settings/EditLicenseModal";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import NoticeStack from "@/components/Notices/NoticeStack";
import useAccountPlanNotices from "@/components/Notices/useAccountPlanNotices";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import { isCloud } from "@/services/env";
import RefreshLicenseButton from "./RefreshLicenseButton";
import DownloadLicenseUsageButton from "./DownloadLicenseUsageButton";

const ShowLicenseInfo: FC<{
  showInput?: boolean;
  /** False when the surrounding card already titles the block. */
  showHeading?: boolean;
}> = ({ showInput = true, showHeading = true }) => {
  const { accountPlan, license, refreshOrganization, subscription } = useUser();
  const planNotices = useAccountPlanNotices();
  const permissionsUtil = usePermissionsUtil();
  const [editLicenseOpen, setEditLicenseOpen] = useState(false);

  const [upgradeModal, setUpgradeModal] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  // The accountPlan is the effective plan given possible downgrades.
  // but we want to show the actual plan on the license.
  const actualPlan = license?.plan || accountPlan;

  const showUpgradeButton = ["oss", "starter"].includes(actualPlan || "");
  const licensePlanText =
    (actualPlan === "enterprise"
      ? "Enterprise"
      : actualPlan === "pro"
        ? "Pro"
        : actualPlan === "pro_sso"
          ? "Pro + SSO"
          : "Starter") + (license && license.isTrial ? " (trial)" : "");

  const showInstallationChart =
    !isCloud() &&
    license?.plan === "enterprise" &&
    Object.keys(license?.installationUsers || {}).length > 1;

  const showSeatUsage =
    license?.plan === "enterprise" && !showInstallationChart;
  const planColor =
    actualPlan === "enterprise"
      ? "indigo"
      : actualPlan === "pro" || actualPlan === "pro_sso"
        ? "gold"
        : "gray";

  const statusActive = ["active", "trialing"].includes(
    subscription?.status || "",
  );
  const licenseDetails: DataListItem[] = [
    ...(showInput
      ? [
          {
            label: "License key",
            value: (
              <Flex align="center" gap="2">
                <Text color="text-mid">
                  {license ? "***************" : "(none)"}
                </Text>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditLicenseOpen(true)}
                >
                  Edit
                </Button>
              </Flex>
            ),
          },
        ]
      : []),
    // A license might not have a plan if a stripe pro form is not filled out
    ...(license?.plan
      ? [
          ...(["pro", "pro_sso"].includes(license.plan) && subscription?.status
            ? [
                {
                  label: "Status",
                  value: (
                    <Badge
                      label={subscription.status}
                      color={statusActive ? "green" : "red"}
                      variant="soft"
                    />
                  ),
                },
              ]
            : []),
          { label: "Issued", value: date(license.dateCreated || "") },
          { label: "Expires", value: date(license.dateExpires || "") },
          { label: "Seats", value: String(license.seats) },
          ...(license.id?.startsWith("license") && showSeatUsage
            ? [{ label: "Seats in use", value: String(license.seatsInUse) }]
            : []),
        ]
      : []),
  ];

  return (
    <Box>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="settings"
          commercialFeature={null}
        />
      )}
      {editLicenseOpen && (
        <EditLicenseModal
          close={() => setEditLicenseOpen(false)}
          mutate={refreshOrganization}
        />
      )}
      <Box>
        {showHeading && <Separator size="4" my="3" />}
        <Flex justify="start" gap="4">
          {showHeading && (
            <Box width="220px">
              <Heading as="h4" size="md">
                License
              </Heading>
            </Box>
          )}
          <Flex direction="column" gap="4" flexGrow="1" minWidth="0">
            <Box>
              <Text as="div" weight="semibold" mb="2">
                Plan type
              </Text>
              <Flex align="center" gap="3" wrap="wrap">
                <Badge
                  label={licensePlanText.toUpperCase()}
                  color={planColor}
                  variant="solid"
                  radius="full"
                />
                {showUpgradeButton && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setUpgradeModal(true)}
                  >
                    Upgrade
                  </Button>
                )}
                {permissionsUtil.canManageBilling() &&
                  license?.id?.startsWith("license") && (
                    <RefreshLicenseButton setError={setRefreshError} />
                  )}
              </Flex>
              {refreshError && (
                <HelperText status="error" mt="1">
                  {refreshError}
                </HelperText>
              )}
            </Box>
            <NoticeStack notices={planNotices} />
            {permissionsUtil.canManageBilling() && (
              <>
                <DataList data={licenseDetails} maxColumns={5} />
                {license && !license.id?.startsWith("license") && (
                  <Box>
                    <DownloadLicenseUsageButton />
                  </Box>
                )}
              </>
            )}
            {showInstallationChart && (
              <Box>
                <Text as="div" weight="medium" mb="2">
                  Seats in use
                </Text>
                <Table variant="surface">
                  <TableHeader>
                    <TableRow>
                      <TableColumnHeader>Installation</TableColumnHeader>
                      <TableColumnHeader>Seats used</TableColumnHeader>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(license?.installationUsers || {}).map(
                      ([id, { installationName, userHashes }]) => (
                        <TableRow key={id}>
                          <TableCell>{installationName || id}</TableCell>
                          <TableCell>{userHashes.length}</TableCell>
                        </TableRow>
                      ),
                    )}
                    <TableRow key="total">
                      <TableCell>
                        <Text weight="semibold">Total distinct users</Text>
                      </TableCell>
                      <TableCell>
                        <Text weight="semibold">
                          {license?.seatsInUse || 0}
                        </Text>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Box>
            )}
          </Flex>
        </Flex>
      </Box>
    </Box>
  );
};

export default ShowLicenseInfo;
