import React from "react";
import { useUser } from "@/services/UserContext";
import CustomFields from "@/components/CustomFields/CustomFields";
import PremiumEmptyState from "@/components/PremiumEmptyState";

const CustomFieldsPage = (): React.ReactElement => {
  const { hasCommercialFeature } = useUser();
  const hasCustomFieldAccess = hasCommercialFeature("custom-metadata");

  if (!hasCustomFieldAccess) {
    return (
      <div className="contents container-fluid pagecontents">
        <PremiumEmptyState
          title="Custom Fields"
          description="Custom fields allow you to add additional meta data to
                  experiments and feature flags that can be required or
                  optional."
          commercialFeature="custom-metadata"
          reason="Custom Fields landing page no access"
          learnMoreLink="https://docs.growthbook.io/using/growthbook-best-practices#custom-fields"
        />
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
