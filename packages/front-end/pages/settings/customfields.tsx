import React, { useState } from "react";
import { useUser } from "@/services/UserContext";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import CustomFields from "@/components/CustomFields/CustomFields";
import LinkButton from "@/components/Radix/LinkButton";
import Button from "@/components/Radix/Button";

const CustomFieldsPage = (): React.ReactElement => {
  const { hasCommercialFeature } = useUser();
  const [upgradeModal, setUpgradeModal] = useState(false);
  const hasCustomFieldAccess = hasCommercialFeature("custom-metadata");

  if (!hasCustomFieldAccess) {
    return (
      <div className="contents container-fluid pagecontents">
        <div className="mb-5">
          <div className="mb-3">
            <div className="appbox p-5 text-center">
              <div className="py-2">
                <h2>Custom Fields</h2>
                <p>
                  Custom fields allow you to add additional meta data to
                  experiments and feature flags that can be required or
                  optional. Custom fields are part of our enterprise plan.
                </p>
                <div className="mt-3">
                  <LinkButton
                    href="https://docs.growthbook.io/using/growthbook-best-practices#custom-fields"
                    variant="outline"
                    mr="3"
                    external={true}
                  >
                    View docs
                  </LinkButton>
                  <Button
                    onClick={() => {
                      setUpgradeModal(true);
                    }}
                  >
                    Upgrade Plan
                  </Button>
                </div>
              </div>
            </div>
            {upgradeModal && (
              <UpgradeModal
                close={() => setUpgradeModal(false)}
                reason="Add custom metadata,"
                source="custom-fields"
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="contents container-fluid pagecontents">
        <CustomFields section={"feature"} title={"Custom Feature Fields"} />
        <CustomFields
          section={"experiment"}
          title={"Custom Experiment Fields"}
        />
      </div>
    </>
  );
};

export default CustomFieldsPage;
