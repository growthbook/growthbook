import { FC } from "react";
import { ApiKeyInterface } from "back-end/types/apikey";
import Link from "next/link";
import { FaAngleRight } from "react-icons/fa";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import SecretApiKeys from "./SecretApiKeys";

const ApiKeys: FC = () => {
  const { data, error, mutate } = useApi<{ keys: ApiKeyInterface[] }>("/keys");

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <>
      <SecretApiKeys keys={data.keys} mutate={mutate} />

      <div className="alert alert-info">
        Looking for SDK Endpoints? They have moved to the new{" "}
        <Link href="/sdks">
          <a>
            Features <FaAngleRight /> SDKs
          </a>
        </Link>{" "}
        tab. Also, make sure to check out the new{" "}
        <strong>SDK Connections</strong>, which makes it easier to configure and
        test your integrations.
      </div>
    </>
  );
};

export default ApiKeys;
