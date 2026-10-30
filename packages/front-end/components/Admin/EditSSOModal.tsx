import { useState } from "react";
import { Flex, TextArea, useThemeContext } from "@radix-ui/themes";
import { useForm } from "react-hook-form";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import stringify from "json-stringify-pretty-compact";
import { SSOConnectionInterface } from "shared/types/sso-connection";
import { useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import StringArrayField from "@/ui/StringArrayField";
import Checkbox from "@/ui/Checkbox";
import Code from "@/components/SyntaxHighlighting/Code";
import Heading from "@/ui/Heading";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";

function generateSSOConnection(
  data: SSOConnectionInterface,
): SSOConnectionInterface {
  const res: SSOConnectionInterface = {
    ...data,
  };

  // Generate additionalScope, extraQueryParams, metadata based on idP type
  // Note: no `logout_endpoint` on purpose. Setting it redirects "Log out" to the
  // IdP's logout URL, which ends the user's IdP session too (and leaves them on
  // the IdP). Logging out of GrowthBook should only log them out of GrowthBook.
  if (data.idpType === "okta") {
    if (data.baseURL) {
      // Remove trailing slash
      const baseURL = data.baseURL.replace(/\/+$/, "");

      res.additionalScope = "offline_access";
      res.extraQueryParams = undefined;
      res.metadata = {
        issuer: `${baseURL}`,
        authorization_endpoint: `${baseURL}/oauth2/v1/authorize`,
        id_token_signing_alg_values_supported: ["RS256"],
        jwks_uri: `${baseURL}/oauth2/v1/keys`,
        token_endpoint: `${baseURL}/oauth2/v1/token`,
        code_challenge_methods_supported: ["S256"],
      };
    }
  } else if (data.idpType === "google") {
    res.extraQueryParams = {
      access_type: "offline",
      prompt: "consent",
    };
    res.additionalScope = "";
    res.metadata = {
      issuer: "https://accounts.google.com",
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token",
      jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
    };
  } else if (data.idpType === "auth0") {
    if (data.tenantId) {
      res.additionalScope = "offline_access";
      res.extraQueryParams = undefined;
      res.metadata = {
        issuer: `https://${data.tenantId}.auth0.com/`,
        authorization_endpoint: `https://${data.tenantId}.auth0.com/authorize`,
        id_token_signing_alg_values_supported: ["HS256", "RS256"],
        jwks_uri: `https://${data.tenantId}.auth0.com/.well-known/jwks.json`,
        token_endpoint: `https://${data.tenantId}.auth0.com/oauth/token`,
        code_challenge_methods_supported: ["S256", "plain"],
        audience: data.audience || "",
      };
    }
  } else if (data.idpType === "azure") {
    if (data.tenantId) {
      res.additionalScope = "offline_access";
      res.extraQueryParams = undefined;
      res.metadata = {
        token_endpoint: `https://login.microsoftonline.com/${data.tenantId}/oauth2/v2.0/token`,
        jwks_uri: `https://login.microsoftonline.com/${data.tenantId}/discovery/v2.0/keys`,
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        issuer: `https://login.microsoftonline.com/${data.tenantId}/v2.0`,
        authorization_endpoint: `https://login.microsoftonline.com/${data.tenantId}/oauth2/v2.0/authorize`,
      };
    }
  } else if (data.idpType === "onelogin") {
    if (data.baseURL) {
      // Remove trailing slash
      const baseURL = data.baseURL.replace(/\/+$/, "");
      res.additionalScope = "";
      res.extraQueryParams = undefined;
      res.metadata = {
        issuer: `${baseURL}/oidc/2`,
        authorization_endpoint: `${baseURL}/oidc/2/auth`,
        token_endpoint: `${baseURL}/oidc/2/token`,
        id_token_signing_alg_values_supported: ["RS256", "HS256", "PS256"],
        jwks_uri: `${baseURL}/oidc/2/certs`,
        code_challenge_methods_supported: ["S256"],
      };
    }
  } else if (data.idpType === "jumpcloud") {
    res.additionalScope = "offline_access";
    res.extraQueryParams = undefined;
    res.metadata = {
      token_endpoint: "https://oauth.id.jumpcloud.com/oauth2/token",
      jwks_uri: "https://oauth.id.jumpcloud.com/.well-known/jwks.json",
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
      issuer: "https://oauth.id.jumpcloud.com/",
      authorization_endpoint: "https://oauth.id.jumpcloud.com/oauth2/auth",
      audience: "",
    };
  }

  return res;
}

function jsonSafeParse(str: string) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

export default function EditSSOModal({
  close,
  organizationId,
  organizationName,
  currentSSO,
  enforced,
  onSave,
}: {
  close: () => void;
  organizationId: string;
  organizationName: string;
  currentSSO?: SSOConnectionInterface;
  enforced?: boolean;
  onSave?: () => void;
}) {
  const { apiCall } = useAuth();

  const [enforceSSO, setEnforceSSO] = useState<boolean>(enforced || false);

  const form = useForm<
    Omit<SSOConnectionInterface, "metadata"> & {
      metadata: string;
    }
  >({
    defaultValues: {
      id: currentSSO?.id || "",
      organization: organizationId,
      clientId: currentSSO?.clientId || "",
      clientSecret: currentSSO?.clientSecret || "",
      additionalScope: currentSSO?.additionalScope || "",
      metadata: currentSSO?.metadata ? JSON.stringify(currentSSO.metadata) : "",
      emailDomains: currentSSO?.emailDomains || [],
      idpType: currentSSO?.idpType,
      extraQueryParams: currentSSO?.extraQueryParams || undefined,
      baseURL: currentSSO?.baseURL || "",
      tenantId: currentSSO?.tenantId || "",
      audience: currentSSO?.audience || "",
    },
  });

  const currentValue = {
    id: form.watch("id"),
    organization: form.watch("organization"),
    clientId: form.watch("clientId"),
    clientSecret: form.watch("clientSecret"),
    additionalScope: form.watch("additionalScope"),
    metadata: jsonSafeParse(form.watch("metadata")) || {},
    emailDomains: form.watch("emailDomains"),
    idpType: form.watch("idpType"),
    extraQueryParams: form.watch("extraQueryParams"),
    baseURL: form.watch("baseURL"),
    tenantId: form.watch("tenantId"),
    audience: form.watch("audience"),
  };

  const { appearance } = useThemeContext();

  if (!isCloud()) {
    return null;
  }

  return (
    <ModalStandard
      trackingEventModalType=""
      submit={validatedSubmit(form, async (data) => {
        const payload = generateSSOConnection({
          ...data,
          metadata: jsonSafeParse(data.metadata) || {},
        });

        await apiCall(`/admin/sso-connection`, {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            enforceSSO: enforceSSO,
          }),
        });

        onSave && onSave();
      })}
      open={true}
      header={currentSSO ? "Edit SSO Connection" : "Create SSO Connection"}
      subheader={organizationName}
      cta={currentSSO ? "Save changes" : "Create connection"}
      ctaEnabled={!!currentValue.idpType}
      close={close}
      size="xl"
    >
      <Flex direction="column" gap="4">
        <Select
          label="Identity provider"
          placeholder="Select one..."
          value={currentValue.idpType}
          setValue={(idpType) =>
            form.setValue(
              "idpType",
              idpType as SSOConnectionInterface["idpType"],
            )
          }
        >
          <SelectItem value="okta">Okta</SelectItem>
          <SelectItem value="azure">Azure/Entra</SelectItem>
          <SelectItem value="google">Google</SelectItem>
          <SelectItem value="onelogin">OneLogin</SelectItem>
          <SelectItem value="jumpcloud">JumpCloud</SelectItem>
          <SelectItem value="auth0">Auth0</SelectItem>
          <SelectItem value="oidc">Other OIDC</SelectItem>
        </Select>

        <TextField
          label="SSO ID"
          {...form.register("id")}
          pattern="^[a-zA-Z0-9_]+$"
          required
          disabled={!!currentSSO}
          helpText="A short ID to identify this organization. Examples: 'acme', 'dunder_mifflin', 'initech'"
        />

        <TextField label="Client ID" {...form.register("clientId")} required />

        <TextField
          label="Client secret"
          {...form.register("clientSecret")}
          placeholder={currentSSO ? "(unchanged)" : ""}
          required={!currentSSO}
        />

        <StringArrayField
          size="md"
          label="Email domains"
          value={form.watch("emailDomains") || []}
          onChange={(emailDomains) =>
            form.setValue("emailDomains", emailDomains)
          }
          required
        />

        {currentValue.idpType === "okta" ||
        currentValue.idpType === "onelogin" ? (
          <TextField
            label="Base URL"
            {...form.register("baseURL")}
            type="url"
            required
          />
        ) : null}
        {currentValue.idpType === "azure" ||
        currentValue.idpType === "auth0" ? (
          <TextField
            label="Tenant ID"
            {...form.register("tenantId")}
            required
          />
        ) : null}
        {currentValue.idpType === "auth0" ? (
          <TextField label="Audience" {...form.register("audience")} />
        ) : null}

        <Checkbox
          label="Enforce SSO login"
          id="enforce-sso"
          value={enforceSSO}
          setValue={(v) => setEnforceSSO(v)}
        />

        {currentValue.idpType === "oidc" ? (
          <>
            <TextField
              label="Additional scope"
              {...form.register("additionalScope")}
            />
            <Flex direction="column" gap="2">
              <Text as="label" htmlFor="sso-metadata" weight="semibold">
                Metadata (JSON)
              </Text>
              <TextArea
                id="sso-metadata"
                rows={6}
                {...form.register("metadata")}
                required
              />
            </Flex>
          </>
        ) : currentSSO?.metadata ? (
          <Flex direction="column" gap="2">
            <Heading as="h3" size="sm" mb="0">
              Changes
            </Heading>
            <ReactDiffViewer
              oldValue={sortObj(currentSSO)}
              newValue={sortObj(generateSSOConnection(currentValue))}
              compareMethod={DiffMethod.LINES}
              useDarkTheme={appearance === "dark"}
              styles={{
                contentText: {
                  wordBreak: "break-all",
                },
              }}
            />
          </Flex>
        ) : (
          <Code
            language="json"
            code={stringify(
              generateSSOConnection({
                ...form.getValues(),
                metadata: { issuer: "" },
              }),
            )}
            filename={"Preview"}
          />
        )}
      </Flex>
    </ModalStandard>
  );
}

function sortObj(obj: unknown): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(obj as { [key: string]: unknown })
        .filter(([k]) => k !== "_id" && k !== "__v" && k !== "dateCreated")
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
    null,
    2,
  );
}
