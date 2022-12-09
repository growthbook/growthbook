import { FC } from "react";
import { ApiKeyInterface } from "back-end/types/apikey";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import SDKEndpoints from "../Features/SDKEndpoints";
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
      <SDKEndpoints keys={data.keys} mutate={mutate} />
    </>
  );
};

export default ApiKeys;
