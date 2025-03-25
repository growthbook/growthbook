import useSWR from "swr";
import { useUser } from "@/services/UserContext";
import Callout from "@/components/Radix/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import { getOrbToken } from "@/services/env";

const fetcher = (url: string, orbToken: string) =>
  fetch(url, {
    headers: {
      Authorization: `Bearer ${orbToken}`,
    },
  }).then((res) => res.json());

const useOrbCustomerData = (organizationId: string, orbToken: string) => {
  return useSWR(
    organizationId
      ? `https://api.withorb.com/v1/customers/external_customer_id/${organizationId}`
      : null,
    (url) => fetcher(url, orbToken)
  );
};

export default function OrbPortal({ orgId }: { orgId: string }) {
  const orbToken = getOrbToken();
  const { data, error, isLoading } = useOrbCustomerData(orgId, orbToken);
  const { subscription } = useUser();

  if (subscription?.billingPlatform !== "orb" || !orgId) return null;

  if (isLoading) {
    return <LoadingOverlay />;
  }

  if (error) {
    return <Callout status="error">{error}</Callout>;
  }

  return (
    <div className="pb-3 app-box">
      {data.portal_url ? (
        <iframe
          src={data.portal_url}
          style={{
            width: "100%",
            height: "100vh",
            border: "none",
          }}
          title="Customer Portal"
        />
      ) : null}
    </div>
  );
}
