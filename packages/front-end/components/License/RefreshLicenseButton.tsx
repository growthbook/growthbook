import { FC } from "react";
import { BsArrowRepeat } from "react-icons/bs";
import { LicenseInterface } from "shared/enterprise";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Button from "@/components/Button";

const RefreshLicenseButton: FC = () => {
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();

  const refresh = async () => {
    const res = await apiCall<{ status: number; license: LicenseInterface }>(
      `/license`,
      {
        method: "GET",
      },
    );

    if (res.status !== 200) {
      throw new Error("There was an error fetching the license");
    }
    refreshOrganization();
  };

  return (
    <>
      <Button color="outline-primary" className="nowrap" onClick={refresh}>
        <BsArrowRepeat /> Refresh
      </Button>
    </>
  );
};

export default RefreshLicenseButton;
