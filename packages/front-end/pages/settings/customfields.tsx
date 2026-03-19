import React from "react";
import { Box } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import CustomFields from "@/components/CustomFields/CustomFields";
import PremiumEmptyState from "@/components/PremiumEmptyState";

const CustomFieldsPage = (): React.ReactElement => {
  const { hasCommercialFeature } = useUser();
  const hasCustomFieldAccess = hasCommercialFeature("custom-metadata");

  if (!hasCustomFieldAccess) {
    return (
      <Box className="contents container-fluid pagecontents">
        <PremiumEmptyState
          title="Custom Fields"
          description="Custom fields allow you to add additional meta data to
                  experiments and feature flags that can be required or
                  optional."
          commercialFeature="custom-metadata"
          learnMoreLink="https://docs.growthbook.io/using/growthbook-best-practices#custom-fields"
        />
      </Box>
    );
  }

  return (
    <Box className="contents container-fluid pagecontents">
      <CustomFields />
    </Box>
  );
};

export default CustomFieldsPage;
