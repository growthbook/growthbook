import Link from "next/link";
import { FC } from "react";
import { FaAngleLeft } from "react-icons/fa";
import { SettingsApiResponse } from ".";
import LoadingOverlay from "../../components/LoadingOverlay";
import SubscriptionInfo from "../../components/Settings/SubscriptionInfo";
import useApi from "../../hooks/useApi";

const BillingPage: FC = () => {
  const { data, error } = useApi<SettingsApiResponse>(`/organization`);

  if (!process.env.NEXT_PUBLIC_IS_CLOUD) {
    return (
      <div className="alert alert-info">
        This page is not available for self-hosted installations.
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div className="container-fluid mt-3 pagecontents">
      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      <h1>Billing Settings</h1>

      <div className=" bg-white p-3 border">
        {data.organization.subscription?.status ? (
          <SubscriptionInfo {...data.organization.subscription} />
        ) : (
          <div className="alert alert-warning">
            No subscription info found for your organization.
          </div>
        )}
      </div>
    </div>
  );
};
export default BillingPage;
