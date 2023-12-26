import { FC } from "react";
import { BsArrowRepeat } from "react-icons/bs";
import { LicenseInterface } from "enterprise";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Button from "../Button";

const RefreshLicenseButton: FC = () => {
  const { apiCall } = useAuth();
  const { updateUser } = useUser();

  const refresh = async () => {
    const res = await apiCall<{ status: number; license: LicenseInterface }>(
      `/admin/license`,
      {
        method: "GET",
      }
    );

    if (res.status !== 200) {
      throw new Error("There was an error fetching the license");
    }
    updateUser();
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
