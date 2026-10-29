import React from "react";
import { useUser } from "@/services/UserContext";
import CustomFields from "@/components/CustomFields/CustomFields";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import { docUrl } from "@/components/DocLink";
import SettingsPage from "@/components/Layout/SettingsPage";

const CustomFieldsPage = (): React.ReactElement => {
  const { hasCommercialFeature } = useUser();
  const hasCustomFieldAccess = hasCommercialFeature("custom-metadata");

  if (!hasCustomFieldAccess) {
    return (
      <SettingsPage title="Custom Fields" hideHeader>
        <PremiumEmptyState
          title="Custom Fields"
          description="Custom fields allow you to add additional meta data to
                  experiments and feature flags that can be required or
                  optional."
          commercialFeature="custom-metadata"
          learnMoreLink={docUrl("customMetadata")}
        />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title="Custom Fields" hideHeader>
      <CustomFields />
    </SettingsPage>
  );
};

export default CustomFieldsPage;
