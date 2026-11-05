import { useState } from "react";
import { Flex, TextArea, useThemeContext } from "@radix-ui/themes";
import { useForm } from "react-hook-form";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import stringify from "json-stringify-pretty-compact";
import { SSOConnectionInterface } from "shared/types/sso-connection";
import { OrganizationInterface } from "shared/types/organization";
import { useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import StringArrayField from "@/ui/StringArrayField";
import Callout from "@/ui/Callout";
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

type SSOFormValues = Omit<SSOConnectionInterface, "metadata"> & {
  metadata: string;
};

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
  org,
  currentSSO,
  onSave,
}: {
  close: () => void;
  org: OrganizationInterface;
  currentSSO?: SSOConnectionInterface;
  onSave?: () => void;
}) {
  const { apiCall } = useAuth();

  const [verifiedDomain, setVerifiedDomain] = useState(
    org.verifiedDomain || "",
  );
  const [autoApproveMembers, setAutoApproveMembers] = useState(
    !!org.autoApproveMembers,
  );
  // Vercel organizations are bound to their installation
  const isVercel = !!org.restrictLoginMethod?.startsWith("vercel:");
  const restricted = !!org.restrictLoginMethod && !isVercel;
  // Also on for an organization that signs in through another one's SSO
  const [enableSSO, setEnableSSO] = useState(!!currentSSO || restricted);
  const [requireSSO, setRequireSSO] = useState(restricted);
  // Null follows the SSO ID, which is right almost every time
  const [requiredId, setRequiredId] = useState<string | null>(
    restricted && org.restrictLoginMethod !== currentSSO?.id
      ? (org.restrictLoginMethod ?? null)
      : null,
  );

  const form = useForm<SSOFormValues>({
    defaultValues: {
      id: currentSSO?.id || "",
      organization: org.id,
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

  const toConnection = (values: SSOFormValues) =>
    generateSSOConnection({
      ...values,
      metadata: jsonSafeParse(values.metadata) || {},
    });
  // Snapshot from the first render, so an untouched connection isn't re-saved
  const [initialConnection] = useState(() =>
    sortObj(toConnection(form.getValues())),
  );

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
  const ssoId = currentValue.id ?? "";
  const requiredValue = (requiredId ?? ssoId).trim();

  const { appearance } = useThemeContext();

  return (
    <ModalStandard
      trackingEventModalType=""
      submit={validatedSubmit(form, async (data) => {
        // Without a provider, the only thing to save is a required connection
        if (enableSSO && !data.idpType && !requireSSO) {
          throw new Error(
            "Select an identity provider, or uncheck Enable SSO.",
          );
        }
        // First, so a required connection exists by the time it's set below
        const connection = toConnection(data);
        if (
          enableSSO &&
          data.idpType &&
          sortObj(connection) !== initialConnection
        ) {
          await apiCall(`/admin/sso-connection`, {
            method: "POST",
            body: JSON.stringify(connection),
          });
        }

        // Only what changed, like the other organization edits
        const changes: Partial<OrganizationInterface> = {};
        if (verifiedDomain !== (org.verifiedDomain || "")) {
          changes.verifiedDomain = verifiedDomain;
        }
        if (autoApproveMembers !== !!org.autoApproveMembers) {
          changes.autoApproveMembers = autoApproveMembers;
        }
        const restrictLoginMethod =
          enableSSO && requireSSO ? requiredValue : "";
        if (
          isCloud() &&
          !isVercel &&
          restrictLoginMethod !== (org.restrictLoginMethod || "")
        ) {
          changes.restrictLoginMethod = restrictLoginMethod;
        }
        if (Object.keys(changes).length) {
          await apiCall("/admin/organization", {
            method: "PUT",
            body: JSON.stringify({ orgId: org.id, ...changes }),
          });
        }

        onSave && onSave();
      })}
      open={true}
      header="Edit Login and SSO"
      subheader={org.name}
      cta="Save changes"
      close={close}
      // Wide enough for the side-by-side diff of an existing connection
      size={currentSSO ? "xl" : "lg"}
    >
      <Flex direction="column" gap="4">
        <TextField
          label="Verified domain"
          value={verifiedDomain}
          helpText="New users with an email on this domain can auto-join this organization."
          onChange={(e) => setVerifiedDomain(e.target.value)}
        />
        <Checkbox
          id="autoApproveMembers"
          label="Auto-approve members with this email domain"
          value={autoApproveMembers}
          setValue={setAutoApproveMembers}
        />

        {isCloud() && (
          <Checkbox
            id="enable-sso"
            label="Enable SSO"
            value={enableSSO}
            setValue={setEnableSSO}
            disabled={!!currentSSO}
            disabledMessage="SSO connections can't be removed here"
          />
        )}

        {isCloud() && enableSSO && (
          <>
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

            {/* Without one, nothing is saved, as when signing in through another organization's SSO */}
            {currentValue.idpType && (
              <>
                <TextField
                  label="SSO ID"
                  {...form.register("id")}
                  pattern="^[a-zA-Z0-9_]+$"
                  required
                  disabled={!!currentSSO}
                  helpText="A short ID to identify this organization. Examples: 'acme', 'dunder_mifflin', 'initech'"
                />

                <TextField
                  label="Client ID"
                  {...form.register("clientId")}
                  required
                />

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
                {currentValue.idpType === "oidc" && (
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
                )}
              </>
            )}

            {!isVercel && (
              <>
                <Checkbox
                  label="Require SSO login"
                  id="enforce-sso"
                  value={requireSSO}
                  setValue={(v) => setRequireSSO(v)}
                />
                {requireSSO && (
                  <TextField
                    label="Required SSO connection ID"
                    value={requiredId ?? ssoId}
                    required
                    onChange={(e) => setRequiredId(e.target.value)}
                  />
                )}
                {requireSSO && requiredValue && requiredValue !== ssoId && (
                  <Callout status="warning">
                    Members will have to sign in through{" "}
                    <code>{requiredValue}</code>, which isn&apos;t this
                    organization&apos;s SSO connection. Make sure that&apos;s
                    intentional.
                  </Callout>
                )}
              </>
            )}

            {!currentValue.idpType ||
            currentValue.idpType === "oidc" ? null : currentSSO?.metadata ? (
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
          </>
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
