import { SDKConnectionInterface } from "shared/types/sdk-connection";
import React, { ReactElement, useEffect, useMemo, useState } from "react";
import { FeatureInterface } from "shared/types/feature";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSDKConnections from "@/hooks/useSDKConnections";
import CodeSnippetModal from "@/components/Features/CodeSnippetModal";
import Callout from "@/ui/Callout";
import CreateSDKConnectionModal from "./CreateSDKConnectionModal";

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
  const connections = useMemo(
    () => data?.connections.filter((c) => !c.archived),
    [data],
  );

  const [currentConnection, setCurrentConnection] =
    useState<SDKConnectionInterface | null>(null);

  useEffect(() => {
    setCurrentConnection(connections?.[0] ?? null);
  }, [connections]);

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
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
    <CreateSDKConnectionModal
      close={close ?? (() => undefined)}
      mutate={mutate}
      cta="Continue"
      autoCloseOnSubmit={false}
      initialValue={{ includeRuleIds: true }}
    />
  );
}
