import { useRouter } from "next/router";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import Field from "@/components/Forms/Field";
import track from "@/services/track";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";

type AuthorizeInfoResponse = {
  status: number;
  message?: string;
  client?: { clientId: string; clientName: string };
  redirectUri?: string;
  organizations?: { id: string; name: string }[];
  user?: { id: string; email: string; name: string };
};

// Shared narrow-page wrapper so the consent and success screens can't drift.
function ConsentPageWrapper({ children }: { children: ReactNode }) {
  return (
    <Box maxWidth="480px" mx="auto" my="9" px="4">
      {children}
    </Box>
  );
}

/**
 * OAuth consent page. MCP (and future CLI) clients redirect here with
 * client_id, redirect_uri, code_challenge, state, etc. The user must already
 * be logged in (normal AuthProvider flow); they pick an organization and
 * approve, then we mint an auth code and redirect back to the client.
 */
export default function OAuthAuthorizePage() {
  const router = useRouter();
  const { apiCall, isAuthenticated, loading: authLoading } = useAuth();

  const query = useMemo(() => {
    const q = router.query;
    return {
      client_id: typeof q.client_id === "string" ? q.client_id : "",
      redirect_uri: typeof q.redirect_uri === "string" ? q.redirect_uri : "",
      response_type: typeof q.response_type === "string" ? q.response_type : "",
      code_challenge:
        typeof q.code_challenge === "string" ? q.code_challenge : "",
      code_challenge_method:
        typeof q.code_challenge_method === "string"
          ? q.code_challenge_method
          : "S256",
      state: typeof q.state === "string" ? q.state : "",
      scope: typeof q.scope === "string" ? q.scope : "",
      resource: typeof q.resource === "string" ? q.resource : "",
      // Not part of the OAuth protocol — an optional hint a client can append
      // to pre-fill the org name for brand-new users with no organization.
      suggested_org_name:
        typeof q.suggested_org_name === "string" ? q.suggested_org_name : "",
    };
  }, [router.query]);

  const [orgId, setOrgId] = useState("");
  const [newOrgName, setNewOrgName] = useState("");
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [completedRedirectTo, setCompletedRedirectTo] = useState<string | null>(
    null,
  );

  const hasRequiredParams = !!query.client_id && !!query.redirect_uri;

  const infoQueryString = new URLSearchParams({
    client_id: query.client_id,
    redirect_uri: query.redirect_uri,
  }).toString();
  const {
    data: info,
    error: infoFetchError,
    isLoading: loadingInfo,
    mutate: mutateInfo,
  } = useApi<AuthorizeInfoResponse>(
    `/oauth/authorize/info?${infoQueryString}`,
    {
      // This page is `noOrganization` — the user picks the org here.
      orgScoped: false,
      autoRevalidate: false,
      shouldRun: () =>
        router.isReady && !authLoading && isAuthenticated && hasRequiredParams,
    },
  );

  const hasNoOrgs = !!info && info.organizations?.length === 0;

  // Pre-select when there is only one org to choose from; pre-fill the new-org
  // name from the client's hint for users with no organization yet.
  useEffect(() => {
    if (info?.organizations?.length === 1) {
      setOrgId(info.organizations[0].id);
    }
    if (info?.organizations?.length === 0 && query.suggested_org_name) {
      setNewOrgName((current) => current || query.suggested_org_name);
    }
  }, [info, query.suggested_org_name]);

  const missingParamsError =
    router.isReady && !hasRequiredParams
      ? "Missing required parameters: client_id and redirect_uri"
      : "";
  const infoError =
    infoFetchError?.message ||
    (info && (info.status !== 200 || !info.client)
      ? info.message || "Failed to load authorization request"
      : "");
  const error = actionError || missingParamsError || infoError;

  const deny = useCallback(() => {
    if (!query.redirect_uri) {
      setActionError("Cannot deny: missing redirect_uri");
      return;
    }
    try {
      const url = new URL(query.redirect_uri);
      url.searchParams.set("error", "access_denied");
      url.searchParams.set(
        "error_description",
        "The user denied the authorization request",
      );
      if (query.state) url.searchParams.set("state", query.state);
      window.location.assign(url.toString());
    } catch {
      setActionError("Invalid redirect_uri");
    }
  }, [query.redirect_uri, query.state]);

  const approve = useCallback(async () => {
    if (!orgId && !hasNoOrgs) {
      setActionError("Please select an organization");
      return;
    }
    if (hasNoOrgs && newOrgName.trim().length < 3) {
      setActionError("Organization name must be at least 3 characters");
      return;
    }
    setSubmitting(true);
    setActionError("");
    try {
      let organization = orgId;

      // Brand-new user: create their organization inline, then authorize for
      // it. If authorization fails after this point, the org still exists
      // (same as the normal signup flow) — the re-fetched info shows it in
      // the picker so the user can simply retry.
      if (hasNoOrgs) {
        const createRes = await apiCall<{
          orgId?: string;
          status: number;
          message?: string;
        }>("/organization", {
          method: "POST",
          body: JSON.stringify({ company: newOrgName.trim() }),
        });
        if (createRes.status >= 400 || !createRes.orgId) {
          setActionError(
            createRes.message || "Failed to create the organization",
          );
          setSubmitting(false);
          return;
        }
        track("Create Organization", { source: "oauth-authorize" });
        organization = createRes.orgId;
      }

      const res = await apiCall<{
        status: number;
        redirectTo?: string;
        message?: string;
      }>("/oauth/authorize", {
        method: "POST",
        body: JSON.stringify({
          client_id: query.client_id,
          redirect_uri: query.redirect_uri,
          code_challenge: query.code_challenge,
          code_challenge_method: query.code_challenge_method,
          state: query.state || undefined,
          scope: query.scope || undefined,
          resource: query.resource || undefined,
          organization,
        }),
      });
      if (res.status !== 200 || !res.redirectTo) {
        setActionError(res.message || "Authorization failed");
        setSubmitting(false);
        if (hasNoOrgs) await mutateInfo();
        return;
      }
      // Custom-scheme redirects (cursor://, etc.) often leave this tab open.
      // Show success immediately, then attempt the redirect.
      setCompletedRedirectTo(res.redirectTo);
      setSubmitting(false);
      window.location.assign(res.redirectTo);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
      if (hasNoOrgs) await mutateInfo();
    }
  }, [apiCall, orgId, hasNoOrgs, newOrgName, query, mutateInfo]);

  // Unauthenticated users are redirected to login by AuthProvider; keep the
  // overlay up during that transient state instead of flashing the page.
  if (authLoading || !isAuthenticated || !router.isReady || loadingInfo) {
    return <LoadingOverlay />;
  }

  if (completedRedirectTo) {
    return (
      <ConsentPageWrapper>
        <Heading as="h1" size="x-large" mb="2">
          Authorization Complete
        </Heading>
        <Callout status="success" mb="4">
          You can return to the application. This tab can stay open.
        </Callout>
        <Text as="p" size="medium" color="text-mid" mb="4">
          If you were not redirected automatically, use the link below.
        </Text>
        <Button
          onClick={() => {
            window.location.assign(completedRedirectTo);
          }}
        >
          Open application
        </Button>
      </ConsentPageWrapper>
    );
  }

  return (
    <ConsentPageWrapper>
      <Heading as="h1" size="x-large" mb="2">
        Authorize Application
      </Heading>
      <Text as="p" size="medium" color="text-mid" mb="4">
        {info?.client
          ? `${info.client.clientName} wants to access your GrowthBook account.`
          : "An application wants to access your GrowthBook account."}
      </Text>

      {error ? (
        <Callout status="error" mb="4">
          {error}
        </Callout>
      ) : null}

      {info?.user ? (
        <Text as="p" size="medium" color="text-mid" mb="3">
          Signed in as{" "}
          <Text as="span" size="inherit" weight="semibold">
            {info.user.email}
          </Text>
        </Text>
      ) : null}

      {info?.organizations && info.organizations.length > 0 ? (
        <Box mb="4">
          <Select
            label="Organization"
            value={orgId || undefined}
            setValue={setOrgId}
            placeholder="Select an organization"
          >
            {info.organizations.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </Select>
        </Box>
      ) : hasNoOrgs && !error ? (
        <Box mb="4">
          <Text as="p" size="medium" color="text-mid" mb="3">
            To get started, create your organization. It only needs a name — you
            can fill in the rest later.
          </Text>
          <Field
            label="Organization name"
            value={newOrgName}
            onChange={(e) => setNewOrgName(e.target.value)}
            placeholder="Acme Inc."
            minLength={3}
            maxLength={60}
            required
          />
        </Box>
      ) : null}

      <Text as="p" size="medium" color="text-mid" mb="4">
        This will allow the application to act as you within the selected
        organization, with the same permissions you have in GrowthBook.
      </Text>

      <Flex gap="3" justify="end">
        <Button
          variant="soft"
          color="gray"
          onClick={deny}
          disabled={submitting}
        >
          Deny
        </Button>
        <Button
          onClick={approve}
          disabled={
            submitting ||
            !!error ||
            (hasNoOrgs ? newOrgName.trim().length < 3 : !orgId)
          }
          loading={submitting}
        >
          {hasNoOrgs ? "Create organization & authorize" : "Authorize"}
        </Button>
      </Flex>
    </ConsentPageWrapper>
  );
}

// Authenticated page, but do not force an org context — the user picks org here.
OAuthAuthorizePage.noOrganization = true;
OAuthAuthorizePage.liteLayout = true;
