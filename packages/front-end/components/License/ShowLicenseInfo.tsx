import { FC, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { date } from "shared/dates";
import { useUser } from "@/services/UserContext";
import EditLicenseModal from "@/components/Settings/EditLicenseModal";
import { GBPremiumBadge } from "@/components/Icons";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import AccountPlanNotices from "@/components/Layout/AccountPlanNotices";
import { isCloud } from "@/services/env";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import RefreshLicenseButton from "./RefreshLicenseButton";
import DownloadLicenseUsageButton from "./DownloadLicenseUsageButton";

const ShowLicenseInfo: FC<{
  showInput?: boolean;
}> = ({ showInput = true }) => {
  const { accountPlan, license, refreshOrganization, organization } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const [editLicenseOpen, setEditLicenseOpen] = useState(false);

  const [upgradeModal, setUpgradeModal] = useState(false);

  // 账户计划是考虑到可能降级后的有效计划。
  // 但我们想在许可证上显示实际的计划。
  const actualPlan = license?.plan || accountPlan;

  const showUpgradeButton = ["oss", "starter"].includes(actualPlan || "");
  const licensePlanText =
    (actualPlan === "enterprise"
      ? "企业版"
      : actualPlan === "pro"
        ? "专业版"
        : actualPlan === "pro_sso"
          ? "专业版 + SSO"
          : "入门版") + (license && license.isTrial ? "（试用）" : "");

  // TODO: 一旦我们将所有组织迁移到使用许可证密钥，就删除这部分
  const usesLicenseInfoOnModel =
    isCloud() && !showUpgradeButton && !organization?.licenseKey;

  const shouldHideLicenseTab = true;

  return (
    <div>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          reason=""
          source="settings"
        />
      )}
      {editLicenseOpen && (
        <EditLicenseModal
          close={() => setEditLicenseOpen(false)}
          mutate={refreshOrganization}
        />
      )}
      {!shouldHideLicenseTab && (
        <div>
          <div className="divider border-bottom mb-3 mt-3" />
          <div className="row">
            <div className="col-sm-3">
              <h4>许可证</h4>
            </div>
            <div className="col-sm-9">
              <div className="form-group row mb-2">
                <div className="col-sm-12">
                  <strong>计划类型：</strong> {licensePlanText}{" "}
                </div>
                <AccountPlanNotices />
              </div>
              {showUpgradeButton && (
                <div className="form-group row mb-1">
                  <div className="col-sm-12">
                    <button
                      className="btn btn-premium font-weight-normal"
                      onClick={() => setUpgradeModal(true)}
                    >
                      <>
                        <GBPremiumBadge /> 升级
                      </>
                    </button>
                  </div>
                </div>
              )}
              {permissionsUtil.canManageBilling() &&
                !usesLicenseInfoOnModel && (
                  <div className="form-group row mt-3 mb-0">
                    {showInput && (
                      <div className="col-auto mr-3 nowrap">
                        <div>
                          <strong>许可证密钥：</strong>
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
                          {license ? "***************" : "(无)"}
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
                      license.plan && ( // 如果未填写Stripe专业版表单，许可证可能没有计划
                        <>
                          {["pro", "pro_sso"].includes(license.plan) &&
                            license.stripeSubscription?.status && (
                              <div className="col-sm-2">
                                <div>状态：</div>
                                <span
                                  className={`text-muted ${!["active", "trialing"].includes(
                                    license.stripeSubscription?.status || ""
                                  )
                                    ? "alert-danger"
                                    : ""
                                    }`}
                                >
                                  {license.stripeSubscription?.status}
                                </span>
                              </div>
                            )}
                          <div className="col-sm-2">
                            <div>颁发时间：</div>
                            <span className="text-muted">
                              {date(license.dateCreated)}
                            </span>
                          </div>
                          <div className="col-sm-2">
                            <div>到期时间：</div>
                            <span className="text-muted">
                              {date(license.dateExpires)}
                            </span>
                          </div>
                          <div className="col-sm-2">
                            <div>座位数：</div>
                            <span className="text-muted">{license.seats}</span>
                          </div>
                        </>
                      )}
                    {license && (
                      <>
                        {license.id.startsWith("license") && (
                          <div className="col-2">
                            <RefreshLicenseButton />
                          </div>
                        )}

                        {!license.id.startsWith("license") && (
                          <div className="mt-3">
                            <DownloadLicenseUsageButton />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
            </div>
          </div>
        </div>)}
    </div>
  );
};

export default ShowLicenseInfo;