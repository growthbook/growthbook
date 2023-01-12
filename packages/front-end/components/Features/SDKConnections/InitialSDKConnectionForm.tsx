import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
  SDKLanguage,
} from "back-end/types/sdk-connection";
import { useForm } from "react-hook-form";
import { ReactElement, useEffect, useState } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import { useEnvironments } from "@/services/features";
import CheckSDKConnectionModal from "@/components/GuidedGetStarted/CheckSDKConnectionModal";
import CodeSnippetModal from "../CodeSnippetModal";
import SDKLanguageSelector from "./SDKLanguageSelector";

export default function InitialSDKConnectionForm({
  close,
  cta,
  inline,
  secondaryCTA,
  goToNextStep,
  error,
  mutate,
  connections,
}: {
  close?: () => void;
  cta?: string;
  inline?: boolean;
  secondaryCTA?: ReactElement;
  goToNextStep: () => void;
  error?: Error;
  mutate: () => void;
  connections: SDKConnectionInterface[];
}) {
  const { apiCall } = useAuth();
  const [currentConnection, setCurrentConnection] = useState(null);
  const [showTestModal, setShowTestModal] = useState(false);

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
      <>
        {connections?.length > 1 && (
          <div className="d-flex justify-content-end">
            <Field
              label="Select SDK Connection"
              options={connections.map((connection) => connection.name)}
              onChange={(e) => {
                const index = connections.findIndex(
                  (connection) => connection.name === e.target.value
                );
                setCurrentConnection(connections[index]);
              }}
            />
          </div>
        )}
        <CodeSnippetModal
          allowChangingLanguage={false}
          close={close}
          cta={cta}
          defaultLanguage={currentConnection.languages[0] || "javascript"}
          limitLanguages={currentConnection.languages}
          inline={inline}
          sdkConnection={currentConnection}
          secondaryCTA={secondaryCTA}
          submit={() => setShowTestModal(true)}
        />
        {showTestModal && (
          <CheckSDKConnectionModal
            close={() => {
              mutate();
              setShowTestModal(false);
            }}
            connection={currentConnection}
            mutate={mutate}
            goToNextStep={goToNextStep}
          />
        )}
      </>
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
        <label>Tell us a little about your tech stack</label>
        <small className="text-muted ml-3">(Select all that apply)</small>
        <SDKLanguageSelector
          value={form.watch("languages")}
          setValue={(languages) => form.setValue("languages", languages)}
          multiple={true}
          includeOther={true}
        />
      </div>
    </Modal>
  );
}
