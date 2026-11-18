import { FC } from "react";
import { PiArrowClockwise } from "react-icons/pi";
import { LicenseInterface } from "shared/enterprise";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Button from "@/ui/Button";

const RefreshLicenseButton: FC<{ setError?: (e: string) => void }> = ({
  setError,
}) => {
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
      <Button
        variant="outline"
        size="sm"
        icon={<PiArrowClockwise />}
        onClick={refresh}
        setError={setError}
      >
        Refresh
      </Button>
    </>
  );
};

export default RefreshLicenseButton;
