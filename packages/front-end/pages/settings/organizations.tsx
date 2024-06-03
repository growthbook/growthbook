import { FC } from "react";
import CreateOrganization from "@/components/Auth/CreateOrganization";
import {
  allowSelfOrgCreation,
  isCloud,
  isMultiOrg,
  showMultiOrgSelfSelector,
} from "@/services/env";

const CreateOrJoinOrganizationPage: FC = () => {
  if (
    isCloud() ||
    !isMultiOrg() ||
    !(showMultiOrgSelfSelector() || allowSelfOrgCreation())
  ) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          This page is only available for self-hosted multi-org customers with
          either SHOW_MULTI_ORG_SELF_SELECTOR or ALLOW_SELF_ORG_CREATION
          environment variables enabled.
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      <CreateOrganization
        showFrame={false}
        title="Join another organization"
        subtitle="Select the organization you would like to join."
      />
    </div>
  );
};
export default CreateOrJoinOrganizationPage;
