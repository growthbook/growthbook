import {
  CreateSDKConnectionParams,
  SDKLanguage,
} from "back-end/types/sdk-connection";
import { useForm } from "react-hook-form";
import { ReactElement, useEffect, useState } from "react";
import { FeatureInterface } from "back-end/types/feature";
import LoadingOverlay from "@/components/LoadingOverlay";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import { useEnvironments } from "@/services/features";
import useSDKConnections from "@/hooks/useSDKConnections";
import CodeSnippetModal from "../CodeSnippetModal";
import SDKLanguageSelector from "./SDKLanguageSelector";

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

  const { apiCall } = useAuth();
  const [currentConnection, setCurrentConnection] = useState(null);

  useEffect(() => {
    setCurrentConnection(() => {
      if (connections && connections[0]) {
        return connections[0];
      } else {
        return null;
      }
    });
  }, [connections]);

  const environments = useEnvironments();

  const form = useForm<{ name: string; languages: SDKLanguage[] }>({
    defaultValues: {
      name: "",
      languages: [],
    },
  });

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
    <Modal
      open={true}
      inline={inline}
      close={close}
      secondaryCTA={secondaryCTA}
      cta="Continue"
      header="Create your first SDK connection"
      autoCloseOnSubmit={false}
      submit={form.handleSubmit(async (value) => {
        if (!value.languages.length) {
          value.languages = ["other"];
        }

        const body: Omit<CreateSDKConnectionParams, "organization"> = {
          name: value.name,
          languages: value.languages,
          encryptPayload: false,
          environment: environments[0]?.id || "production",
          project: "",
          proxyEnabled: false,
          proxyHost: "",
        };
        await apiCall(`/sdk-connections`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        await mutate();
      })}
    >
      <Field label="Name of your app" {...form.register("name")} required />

      <div className="form-group">
        <label>Tech Stack</label>
        <small className="text-muted ml-3">(Select all that apply)</small>
        <SDKLanguageSelector
          value={form.watch("languages")}
          setValue={(languages) => form.setValue("languages", languages)}
          multiple={true}
          includeOther={true}
        />
        <small className="form-text text-muted">
          This helps us give you personalized setup instructions
        </small>
      </div>
    </Modal>
  );
}
