import React, { FC, ReactNode, useState } from "react";
import { date } from "shared/dates";
import { Box, Flex, Grid, Separator } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
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
              <Text as="div" weight="medium" mb="2px">
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
                  <Button variant="ghost" onClick={() => setUpgradeModal(true)}>
                    Upgrade
                  </Button>
                )}
                {license?.id?.startsWith("license") && (
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
                <Grid columns="repeat(auto-fit, minmax(120px, 1fr))" gap="4">
                  {showInput && (
                    <Detail label="License key">
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
                    </Detail>
                  )}
                  {/* A license might not have a plan if a stripe pro form is not filled out */}
                  {license?.plan && (
                    <>
                      {["pro", "pro_sso"].includes(license.plan) &&
                        subscription?.status && (
                          <Detail label="Status">
                            {["active", "trialing"].includes(
                              subscription.status,
                            ) ? (
                              <Text color="text-mid">
                                {subscription.status}
                              </Text>
                            ) : (
                              <HelperText status="error">
                                {subscription.status}
                              </HelperText>
                            )}
                          </Detail>
                        )}
                      <Detail label="Issued">
                        <Text color="text-mid">
                          {date(license.dateCreated || "")}
                        </Text>
                      </Detail>
                      <Detail label="Expires">
                        <Text color="text-mid">
                          {date(license.dateExpires || "")}
                        </Text>
                      </Detail>
                      <Detail label="Seats">
                        <Text color="text-mid">{license.seats}</Text>
                      </Detail>
                      {license.id?.startsWith("license") && showSeatUsage && (
                        <Detail label="Seats in use">
                          <Text color="text-mid">{license.seatsInUse}</Text>
                        </Detail>
                      )}
                    </>
                  )}
                </Grid>
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
                <table className="table gbtable appbox table-sm">
                  <thead>
                    <tr>
                      <th>Installation</th>
                      <th>Seats Used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(license?.installationUsers || {}).map(
                      ([id, { installationName, userHashes }]) => (
                        <tr key={id}>
                          <td>{installationName || id}</td>
                          <td>{userHashes.length}</td>
                        </tr>
                      ),
                    )}
                    <tr key="total" className="font-weight-bold">
                      <td>Total Distinct Users</td>
                      <td>{license?.seatsInUse || 0}</td>
                    </tr>
                  </tbody>
                </table>
              </Box>
            )}
          </Flex>
        </Flex>
      </Box>
    </Box>
  );
};

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Text as="div" weight="medium" mb="2px">
        {label}
      </Text>
      {children}
    </Box>
  );
}

export default ShowLicenseInfo;
