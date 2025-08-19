import React, { FC, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { date } from "shared/dates";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import EditLicenseModal from "@/components/Settings/EditLicenseModal";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import AccountPlanNotices from "@/components/Layout/AccountPlanNotices";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/components/Radix/Button";
import RefreshLicenseButton from "./RefreshLicenseButton";
import DownloadLicenseUsageButton from "./DownloadLicenseUsageButton";

const ShowLicenseInfo: FC<{
  showInput?: boolean;
}> = ({ showInput = true }) => {
  const { accountPlan, license, refreshOrganization, subscription } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const [editLicenseOpen, setEditLicenseOpen] = useState(false);

  const [upgradeModal, setUpgradeModal] = useState(false);

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
        <div className="divider border-bottom mb-3 mt-3" />
        <Flex justify="start" gap="4">
          <Box width="220px">
            <Heading as="h4" size="4">
              License
            </Heading>
          </Box>
          <Box flexGrow="1">
            <Box>
              <div className="form-group row mb-3">
                <div className="col-sm-12">
                  <Flex justify="start" gap="3" align="center">
                    <Box>
                      <Text className="font-weight-semibold">Plan type:</Text>
                    </Box>
                    <Box>{licensePlanText}</Box>
                    {showUpgradeButton && (
                      <Button
                        variant={"ghost"}
                        onClick={() => setUpgradeModal(true)}
                      >
                        Upgrade
                      </Button>
                    )}
                  </Flex>
                </div>
                <Box pl="2">
                  <AccountPlanNotices />
                </Box>
              </div>
              {permissionsUtil.canManageBilling() && (
                <div className="form-group row mt-3 mb-0">
                  {showInput && (
                    <div className="col-auto mr-3 nowrap">
                      <div>
                        <Text className="font-weight-semibold">
                          License Key:{" "}
                        </Text>
                      </div>
                      <div
                        className="d-inline-block mt-1 mb-2 nowrap text-center text-muted"
                        style={{
                          width: 105,
                          borderBottom: "1px solid #cccccc",
                          pointerEvents: "none",
                          overflow: "hidden",
                          verticalAlign: "top",
                        }}
                      >
                        {license ? "***************" : "(none)"}
                      </div>{" "}
                      <a
                        href="#"
                        className="pl-1"
                        onClick={(e) => {
                          e.preventDefault();
                          setEditLicenseOpen(true);
                        }}
                      >
                        <FaPencilAlt />
                      </a>
                    </div>
                  )}
                  {license &&
                    license.plan && ( // A license might not have a plan if a stripe pro form is not filled out
                      <>
                        {["pro", "pro_sso"].includes(license.plan) &&
                          subscription?.status && (
                            <div className="col-sm-2">
                              <div>Status:</div>
                              <span
                                className={`text-muted ${
                                  !["active", "trialing"].includes(
                                    subscription?.status || "",
                                  )
                                    ? "alert-danger"
                                    : ""
                                }`}
                              >
                                {subscription?.status}
                              </span>
                            </div>
                          )}
                        <div className="col-sm-2">
                          <div>Issued:</div>
                          <span className="text-muted">
                            {date(license.dateCreated || "")}
                          </span>
                        </div>
                        <div className="col-sm-2">
                          <div>Expires:</div>
                          <span className="text-muted">
                            {date(license.dateExpires || "")}
                          </span>
                        </div>
                        <div className="col-sm-2">
                          <div>Seats:</div>
                          <span className="text-muted">{license.seats}</span>
                        </div>
                      </>
                    )}
                  {license && (
                    <>
                      {license.id?.startsWith("license") && (
                        <div className="col-2">
                          <RefreshLicenseButton />
                        </div>
                      )}

                      {!license.id?.startsWith("license") && (
                        <div className="mt-3">
                          <DownloadLicenseUsageButton />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </Box>
          </Box>
        </Flex>
      </Box>
    </Box>
  );
};

export default ShowLicenseInfo;
