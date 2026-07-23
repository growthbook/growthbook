import { useForm } from "react-hook-form";
import { ssoConnectionMetadataValidator } from "shared/validators";
import { SSOConnectionInterface } from "shared/types/sso-connection";
import {
  generateSSOConnection,
  getSSOProviderDocsUrl,
  SSO_IDP_TYPE_OPTIONS,
  ssoProviderRequiresBaseURL,
  ssoProviderRequiresTenantId,
} from "shared/util";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import StringArrayField from "@/ui/StringArrayField";
import Callout from "@/ui/Callout";

function jsonSafeParse(str: string) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

export interface Props {
  close: () => void;
  current: Partial<SSOConnectionInterface> | null;
  onSave: () => void;
  // "save" writes the connection to the org via the API. "generate" is for
  // self-hosted instances: nothing is saved, the form instead produces an
  // SSO_CONFIG environment variable value via onGenerate
  mode?: "save" | "generate";
  onGenerate?: (
    envValue: string,
    idpType?: SSOConnectionInterface["idpType"],
  ) => void;
}

export default function EditSSOConnectionModal({
  close,
  current,
  onSave,
  mode = "save",
  onGenerate,
}: Props) {
  const { apiCall } = useAuth();

  const form = useForm({
    defaultValues: {
      idpType: current?.idpType || "",
      clientId: current?.clientId || "",
      clientSecret: "",
      baseURL: current?.baseURL || "",
      tenantId: current?.tenantId || "",
      audience: current?.audience || "",
      additionalScope: current?.additionalScope || "",
      emailDomains: [] as string[],
      metadata:
        current?.idpType === "oidc" && current?.metadata
          ? JSON.stringify(current.metadata)
          : "",
    },
  });

  const idpType = form.watch("idpType");
  const idpLabel = SSO_IDP_TYPE_OPTIONS.find((o) => o.value === idpType)?.label;

  const emailDomains = form.watch("emailDomains");

  return (
    <ModalStandard
      trackingEventModalType="edit-sso-connection"
      open={true}
      close={close}
      header={
        mode === "generate"
          ? "Generate SSO configuration"
          : current
            ? "Edit SSO Connection"
            : "Set Up SSO"
      }
      cta={
        mode === "generate"
          ? "Generate"
          : current
            ? "Save changes"
            : "Create connection"
      }
      size="lg"
      submit={
        mode === "generate"
          ? form.handleSubmit(async (data) => {
              const metadata = jsonSafeParse(data.metadata);
              if (data.idpType === "oidc") {
                if (!metadata) {
                  throw new Error("Metadata must be valid JSON");
                }
                // The API validates metadata in save mode; generated configs
                // bypass the API, and an invalid SSO_CONFIG prevents the
                // server from starting, so validate here instead
                const parsed =
                  ssoConnectionMetadataValidator.safeParse(metadata);
                if (!parsed.success) {
                  const issue = parsed.error.issues[0];
                  throw new Error(
                    `Invalid metadata${
                      issue?.path?.length ? ` (${issue.path.join(".")})` : ""
                    }: ${issue?.message || "unknown error"}`,
                  );
                }
              }
              const conn = generateSSOConnection({
                idpType: (data.idpType ||
                  undefined) as SSOConnectionInterface["idpType"],
                clientId: data.clientId,
                baseURL: data.baseURL,
                tenantId: data.tenantId,
                audience: data.audience,
                additionalScope: data.additionalScope,
                metadata: metadata || { issuer: "" },
              });
              const envConfig = {
                clientId: data.clientId,
                clientSecret: data.clientSecret,
                ...(data.emailDomains?.length
                  ? { emailDomains: data.emailDomains }
                  : {}),
                ...(conn.additionalScope
                  ? { additionalScope: conn.additionalScope }
                  : {}),
                ...(conn.extraQueryParams &&
                Object.keys(conn.extraQueryParams).length
                  ? { extraQueryParams: conn.extraQueryParams }
                  : {}),
                metadata: conn.metadata,
              };
              onGenerate?.(
                JSON.stringify(envConfig),
                (data.idpType ||
                  undefined) as SSOConnectionInterface["idpType"],
              );
            })
          : form.handleSubmit(async (data) => {
              const body: Record<string, unknown> = {
                idpType: data.idpType,
                clientId: data.clientId,
                clientSecret: data.clientSecret || "",
              };
              if (ssoProviderRequiresBaseURL(data.idpType)) {
                body.baseURL = data.baseURL;
              }
              if (ssoProviderRequiresTenantId(data.idpType)) {
                body.tenantId = data.tenantId;
              }
              if (data.idpType === "auth0") {
                body.audience = data.audience;
              }
              if (data.idpType === "oidc") {
                const metadata = jsonSafeParse(data.metadata);
                if (!metadata) {
                  throw new Error("Metadata must be valid JSON");
                }
                body.metadata = metadata;
                body.additionalScope = data.additionalScope;
                if (current?.idpType === "oidc" && current?.extraQueryParams) {
                  body.extraQueryParams = current.extraQueryParams;
                }
              }

              await apiCall("/sso-connection", {
                method: "PUT",
                body: JSON.stringify(body),
              });

              onSave();
            })
      }
    >
      <SelectField
        label="Identity provider"
        value={idpType || ""}
        onChange={(v) => form.setValue("idpType", v)}
        options={SSO_IDP_TYPE_OPTIONS}
        initialOption="Select one..."
        required
        helpText={
          <>
            See the{" "}
            <a
              href={getSSOProviderDocsUrl(idpType)}
              target="_blank"
              rel="noreferrer"
            >
              {idpLabel
                ? `${idpLabel} setup instructions`
                : "SSO setup instructions"}
            </a>{" "}
            for how to configure your provider.
          </>
        }
      />

      <Field label="Client ID" {...form.register("clientId")} required />

      <Field
        label="Client secret"
        type="password"
        autoComplete="off"
        {...form.register("clientSecret")}
        placeholder={current && mode === "save" ? "(unchanged)" : ""}
        required={!current || mode === "generate"}
      />

      {mode === "generate" ? (
        <StringArrayField
          label="Email domains"
          value={emailDomains || []}
          onChange={(domains) => form.setValue("emailDomains", domains)}
          helpText="Optional. Users signing in through your identity provider with a matching email can automatically join your organization."
        />
      ) : null}

      {ssoProviderRequiresBaseURL(idpType) ? (
        <Field
          label="Base URL"
          {...form.register("baseURL")}
          type="url"
          placeholder="https://your-company.okta.com"
          required
        />
      ) : null}
      {ssoProviderRequiresTenantId(idpType) ? (
        <Field label="Tenant ID" {...form.register("tenantId")} required />
      ) : null}
      {idpType === "auth0" ? (
        <Field label="Audience" {...form.register("audience")} />
      ) : null}

      {idpType === "oidc" ? (
        <>
          <Field
            label="Additional scope"
            {...form.register("additionalScope")}
            helpText='Extra OAuth scopes to request beyond "openid profile email"'
          />
          <Field
            label="Metadata (JSON)"
            textarea
            minRows={6}
            {...form.register("metadata")}
            helpText="OpenID Connect metadata for your provider. All endpoints must use https."
            required
          />
        </>
      ) : null}

      {mode === "generate" ? (
        <Callout status="info" mt="3">
          Nothing is saved in GrowthBook &mdash; generating produces an
          SSO_CONFIG environment variable value for you to copy.
        </Callout>
      ) : (
        <Callout status="warning" mt="3">
          Changes take effect within 30 seconds. A misconfigured connection will
          prevent users from signing in through SSO, so verify your settings
          carefully.
          {current?.emailDomains?.length
            ? " Switching to a different identity provider removes your approved email domains — contact support to re-verify them."
            : null}
        </Callout>
      )}
    </ModalStandard>
  );
}
