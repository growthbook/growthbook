import React, { FC } from "react";
import { ApiKeyInterface } from "back-end/types/apikey";
import Link from "next/link";
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

      <div className="alert alert-info mb-4">
        You can also create{" "}
        <Link href="/account/personal-access-tokens">
          Personal Access Tokens
        </Link>{" "}
        for your user account
      </div>

      <div className="alert alert-info">
        Looking for SDK Endpoints? They have moved to the{" "}
        <Link href="/sdks">SDK Connections</Link> page.
      </div>
    </>
  );
};

export default ApiKeys;
