import React, { FC } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import Link from "next/link";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import Callout from "@/ui/Callout";
import SecretApiKeys from "./SecretApiKeys";

const ApiKeys: FC = () => {
  const { data, error, mutate } = useApi<{ keys: ApiKeyInterface[] }>("/keys");

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <>
      <SecretApiKeys keys={data.keys} mutate={mutate} />

      <Callout status="info" mb="4">
        You can also create{" "}
        <Link href="/account/personal-access-tokens">
          Personal Access Tokens
        </Link>{" "}
        for your user account
      </Callout>
    </>
  );
};

export default ApiKeys;
