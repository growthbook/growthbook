import { FC } from "react";
import CreateOrJoinOrganization from "@/components/Auth/CreateOrJoinOrganization";
import {
  allowSelfOrgCreation,
  isCloud,
  isMultiOrg,
  showMultiOrgSelfSelector,
} from "@/services/env";
import Callout from "@/ui/Callout";
import SettingsPage from "@/components/Layout/SettingsPage";

const CreateOrJoinOrganizationPage: FC = () => {
  if (
    isCloud() ||
    !isMultiOrg() ||
    !(showMultiOrgSelfSelector() || allowSelfOrgCreation())
  ) {
    return (
      <SettingsPage title="Join Another Organization">
        <Callout status="error">
          This page is only available for self-hosted multi-org customers with
          either SHOW_MULTI_ORG_SELF_SELECTOR or ALLOW_SELF_ORG_CREATION
          environment variables enabled.
        </Callout>
      </SettingsPage>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      <CreateOrJoinOrganization
        showFrame={false}
        title="Join another organization"
        subtitle="Select the organization you would like to join."
      />
    </div>
  );
};
export default CreateOrJoinOrganizationPage;
