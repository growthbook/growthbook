import { FC } from "react";
import { BsArrowRepeat } from "react-icons/bs";
import { LicenseInterface } from "enterprise";
import { useAuth } from "@front-end/services/auth";
import { useUser } from "@front-end/services/UserContext";
import Button from "@front-end/components/Button";

const RefreshLicenseButton: FC = () => {
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();

  const refresh = async () => {
    const res = await apiCall<{ status: number; license: LicenseInterface }>(
      `/license`,
      {
        method: "GET",
      }
    );

    if (res.status !== 200) {
      throw new Error("There was an error fetching the license");
    }
    refreshOrganization();
  };

  return (
    <>
      <Button color="outline-primary" onClick={refresh}>
        <BsArrowRepeat /> Refresh
      </Button>
    </>
  );
};

export default RefreshLicenseButton;
