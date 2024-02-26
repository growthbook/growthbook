import { FC, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { date } from "shared/dates";
import usePermissions from "@/hooks/usePermissions";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import EditLicenseModal from "../Settings/EditLicenseModal";
import { GBPremiumBadge } from "../Icons";
import UpgradeModal from "../Settings/UpgradeModal";
import AccountPlanNotices from "../Layout/AccountPlanNotices";
import RefreshLicenseButton from "./RefreshLicenseButton";
import DownloadLicenseUsageButton from "./DownloadLicenseUsageButton";

const ShowLicenseInfo: FC<{
  showInput?: boolean;
}> = ({ showInput = true }) => {
  const { accountPlan, license, refreshOrganization } = useUser();
  const permissions = usePermissions();
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
      <div>
        <div className="divider border-bottom mb-3 mt-3" />
        <div className="row">
          <div className="col-sm-3">
            <h4>License</h4>
          </div>
          <div className="col-sm-9">
            <div className="form-group row mb-2">
              <div className="col-sm-12">
                <strong>Plan type: </strong> {licensePlanText}{" "}
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
                    {accountPlan === "oss" ? (
                      <>
                        Try Enterprise <GBPremiumBadge />
                      </>
                    ) : (
                      <>
                        Try Pro <GBPremiumBadge />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
            {!isCloud() && permissions.manageBilling && (
              <div className="form-group row mt-3 mb-0">
                {showInput && (
                  <div className="col-sm-4">
                    <div>
                      <strong>License Key: </strong>
                    </div>
                    <div
                      className="d-inline-block mt-1 mb-2 text-center text-muted"
                      style={{
                        width: 100,
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
                {license && (
                  <>
                    <div className="col-sm-2">
                      <div>Issued:</div>
                      <span className="text-muted">
                        {date(license.dateCreated)}
                      </span>
                    </div>
                    <div className="col-sm-2">
                      <div>Expires:</div>
                      <span className="text-muted">
                        {date(license.dateExpires)}
                      </span>
                    </div>
                    <div className="col-sm-2">
                      <div>Seats:</div>
                      <span className="text-muted">{license.seats}</span>
                    </div>

                    {license.id.startsWith("license") && (
                      <div className="col-sm-2">
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
      </div>
    </div>
  );
};

export default ShowLicenseInfo;
