import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
  SDKLanguage,
} from "back-end/types/sdk-connection";
import { useForm } from "react-hook-form";
import { ReactElement } from "react";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import { useEnvironments } from "@/services/features";
import CodeSnippetModal from "../CodeSnippetModal";
import SDKLanguageSelector from "./SDKLanguageSelector";

export default function InitialSDKConnectionForm({
  close,
  cta,
  inline,
  secondaryCTA,
  submit,
}: {
  close?: () => void;
  cta?: string;
  inline?: boolean;
  secondaryCTA?: ReactElement;
  submit?: () => Promise<void>;
}) {
  const { apiCall } = useAuth();

  const environments = useEnvironments();

  const { data, mutate, error } = useApi<{
    connections: SDKConnectionInterface[];
  }>(`/sdk-connections`);

  const form = useForm<{ name: string; languages: SDKLanguage[] }>({
    defaultValues: {
      name: "",
      languages: [],
    },
  });

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const firstConnection = data?.connections?.[0];

  if (firstConnection) {
    return (
      <CodeSnippetModal
        allowChangingLanguage={false}
        close={close}
        cta={cta}
        defaultLanguage={firstConnection.languages[0] || "javascript"}
        limitLanguages={firstConnection.languages}
        inline={inline}
        sdkConnection={firstConnection}
        secondaryCTA={secondaryCTA}
        submit={submit}
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
