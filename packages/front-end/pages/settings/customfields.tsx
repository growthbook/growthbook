import React from "react";
import { useUser } from "@/services/UserContext";
import CustomFields from "@/components/CustomFields/CustomFields";
import NoAccessState from "@/components/NoAccessState";

const CustomFieldsPage = (): React.ReactElement => {
  const { hasCommercialFeature } = useUser();
  const hasCustomFieldAccess = hasCommercialFeature("custom-metadata");

  if (!hasCustomFieldAccess) {
    return (
      <div className="contents container-fluid pagecontents">
        <NoAccessState
          title="Custom Fields"
          description="Custom fields allow you to add additional meta data to
                  experiments and feature flags that can be required or
                  optional. Custom fields are part of our enterprise plan."
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
