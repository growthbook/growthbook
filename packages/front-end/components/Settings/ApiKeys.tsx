import { FC } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import { ApiKeyInterface } from "back-end/types/apikey";
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
      <SDKEndpoints keys={data.keys} mutate={mutate}/>
      <SecretApiKeys keys={data.keys} mutate={mutate}/>
    </>
  )
};

export default ApiKeys;
