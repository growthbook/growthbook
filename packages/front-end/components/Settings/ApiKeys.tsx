import React, { FC } from "react";
import { ApiKeyInterface } from "back-end/types/apikey";
import Link from "next/link";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
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
        你可以为你的个人账号创建{" "}
        <Link href="/account/personal-access-tokens">
          Token
        </Link>{" "}
      </div>
    </>
  );
};

export default ApiKeys;
