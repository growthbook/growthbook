import { SDKConnectionInterface } from "shared/types/sdk-connection";
import React, { ReactElement, useEffect, useState } from "react";
import { FeatureInterface } from "back-end/types/feature";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSDKConnections from "@/hooks/useSDKConnections";
import CodeSnippetModal from "@/components/Features/CodeSnippetModal";
import SDKConnectionForm from "./SDKConnectionForm";

export default function InitialSDKConnectionForm({
  close,
  cta,
  inline,
  secondaryCTA,
  goToNextStep,
  feature,
  includeCheck,
}: {
  close?: () => void;
  cta?: string;
  inline?: boolean;
  feature?: FeatureInterface;
  secondaryCTA?: ReactElement;
  goToNextStep?: () => void;
  includeCheck?: boolean;
}) {
  const { data, error, mutate } = useSDKConnections();
  const connections = data?.connections;

  const [currentConnection, setCurrentConnection] =
    useState<SDKConnectionInterface | null>(null);

  useEffect(() => {
    setCurrentConnection(() => {
      if (connections && connections[0]) {
        return connections[0];
      } else {
        return null;
      }
    });
  }, [connections]);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!connections) {
    return <LoadingOverlay />;
  }

  if (currentConnection) {
    return (
      <CodeSnippetModal
        close={close}
        cta={cta}
        inline={inline}
        connections={connections}
        sdkConnection={currentConnection}
        secondaryCTA={secondaryCTA}
        feature={feature}
        submit={goToNextStep}
        includeCheck={includeCheck}
        mutateConnections={mutate}
        allowChangingConnection={true}
      />
    );
  }

  return (
    <SDKConnectionForm
      close={close}
      edit={false}
      mutate={mutate}
      cta={"Continue"}
      autoCloseOnSubmit={false}
      initialValue={{
        includeRuleIds: true,
      }}
    />
  );
}
