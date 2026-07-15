import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
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
    };
  }, [router.query]);

  const [info, setInfo] = useState<AuthorizeInfoResponse | null>(null);
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [completedRedirectTo, setCompletedRedirectTo] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!router.isReady || authLoading || !isAuthenticated) return;
    if (!query.client_id || !query.redirect_uri) {
      setError("Missing required parameters: client_id and redirect_uri");
      setLoadingInfo(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({
          client_id: query.client_id,
          redirect_uri: query.redirect_uri,
        });
        const res = await apiCall<AuthorizeInfoResponse>(
          `/oauth/authorize/info?${qs.toString()}`,
        );
        if (cancelled) return;
        if (res.status !== 200 || !res.client) {
          setError(res.message || "Failed to load authorization request");
        } else {
          setInfo(res);
          if (res.organizations?.length === 1) {
            setOrgId(res.organizations[0].id);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoadingInfo(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    router.isReady,
    authLoading,
    isAuthenticated,
    query.client_id,
    query.redirect_uri,
    apiCall,
  ]);

  const deny = useCallback(() => {
    if (!query.redirect_uri) {
      setError("Cannot deny: missing redirect_uri");
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
      setError("Invalid redirect_uri");
    }
  }, [query.redirect_uri, query.state]);

  const approve = useCallback(async () => {
    if (!orgId) {
      setError("Please select an organization");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
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
          organization: orgId,
        }),
      });
      if (res.status !== 200 || !res.redirectTo) {
        setError(res.message || "Authorization failed");
        setSubmitting(false);
        return;
      }
      // Custom-scheme redirects (cursor://, etc.) often leave this tab open.
      // Show success immediately, then attempt the redirect.
      setCompletedRedirectTo(res.redirectTo);
      setSubmitting(false);
      window.location.assign(res.redirectTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }, [apiCall, orgId, query]);

  if (authLoading || !router.isReady || loadingInfo) {
    return <LoadingOverlay />;
  }

  if (completedRedirectTo) {
    return (
      <Box
        style={{
          maxWidth: 480,
          margin: "4rem auto",
          padding: "0 1rem",
        }}
      >
        <Heading as="h1" size="x-large" mb="2">
          Authorization complete
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
      </Box>
    );
  }

  return (
    <Box
      style={{
        maxWidth: 480,
        margin: "4rem auto",
        padding: "0 1rem",
      }}
    >
      <Heading as="h1" size="x-large" mb="2">
        Authorize application
      </Heading>
      <Text as="p" color="text-mid" mb="4">
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
          Signed in as <strong>{info.user.email}</strong>
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
      ) : info && !error ? (
        <Callout status="warning" mb="4">
          You are not a member of any organization.
        </Callout>
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
          disabled={submitting || !orgId || !!error}
          loading={submitting}
        >
          Authorize
        </Button>
      </Flex>
    </Box>
  );
}

// Authenticated page, but do not force an org context — the user picks org here.
OAuthAuthorizePage.noOrganization = true;
OAuthAuthorizePage.liteLayout = true;
