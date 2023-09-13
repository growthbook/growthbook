import React, { useState } from "react";
import { useUser } from "@/services/UserContext";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import UpgradeMessage from "@/components/Marketing/UpgradeMessage";
import CustomFields from "@/components/Settings/CustomFields";

const CustomFieldsPage = (): React.ReactElement => {
  const { hasCommercialFeature } = useUser();
  const [upgradeModal, setUpgradeModal] = useState(false);
  const hasCustomFieldAccess = hasCommercialFeature("custom-exp-metadata");

  if (!hasCustomFieldAccess) {
    return (
      <>
        <div className="contents container-fluid pagecontents">
          <div className="mb-5">
            <div className="row mb-3 align-items-center">
              <div className="col-auto">
                <h3>Custom Fields</h3>
                <p className="text-gray"></p>
              </div>
            </div>
            <div className="row mb-3">
              <div className="col-12 mb-2 py-2">
                <p>
                  Custom experiment fields are available with an Enterprise
                  plan.
                </p>
                <UpgradeMessage
                  showUpgradeModal={() => setUpgradeModal(true)}
                  commercialFeature="override-metrics"
                  upgradeMessage="set custom experiment fields"
                  isEnterprise={true}
                />
              </div>
            </div>
          </div>
        </div>
        {upgradeModal && (
          <>
            <UpgradeModal
              close={() => setUpgradeModal(false)}
              reason="To add custom experiment metadata,"
              source="custom-fields"
            />
          </>
        )}
      </>
    );
  }

  return (
    <>
      <div className="contents container-fluid pagecontents">
        <CustomFields
          section={"experiment"}
          title={"Custom Experiment Fields"}
        />
        <CustomFields section={"feature"} title={"Custom Feature Fields"} />
      </div>
    </>
  );
};

export default CustomFieldsPage;
