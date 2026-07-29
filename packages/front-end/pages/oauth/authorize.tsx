import { useRouter } from "next/router";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiArrowCounterClockwise, PiKey, PiUserCircle } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import UserAvatar from "@/components/Avatar/UserAvatar";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
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

// Loopback hosts are the OS itself, so a code delivered here never leaves the
// user's machine.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

// Where the authorization code will be delivered. This is the one signal on
// this page the app cannot fake: the code always goes to a redirect_uri
// pre-registered by the client.
//
// `isLocal` decides whether it is worth the user's attention. Loopback and
// custom-scheme targets hand the code to something already running on this
// machine, so a remote attacker never receives it and showing a bare
// "localhost:8787" is noise. A remote host is the case that matters, and is
// the only one surfaced.
function describeRedirectTarget(
  redirectUri?: string,
): { host: string; isLocal: boolean } | null {
  if (!redirectUri) return null;
  try {
    const url = new URL(redirectUri);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { host: url.host, isLocal: LOOPBACK_HOSTS.has(url.hostname) };
    }
    // Custom schemes (cursor://, etc.) hand off to a locally installed app.
    return { host: url.protocol.replace(":", "") + "://", isLocal: true };
  } catch {
    return null;
  }
}

// Shared narrow-page wrapper so the consent and success screens can't drift.
function ConsentPageWrapper({ children }: { children: ReactNode }) {
  return (
    <Box maxWidth="520px" mx="auto" my="9" px="4">
      {children}
    </Box>
  );
}

// Icon box is pinned to the text's line-height so the glyph centers on the
// first line rather than floating above it (the same trick Callout uses).
function AccessItem({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Flex gap="3" align="start">
      <Flex
        align="center"
        justify="center"
        flexShrink="0"
        height="var(--line-height-2)"
        style={{ color: "var(--violet-11)" }}
      >
        {icon}
      </Flex>
      <Text size="medium" color="text-mid">
        {children}
      </Text>
    </Flex>
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
    };
  }, [router.query]);

  const [orgId, setOrgId] = useState("");
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

  // Pre-select when there is only one org to choose from
  useEffect(() => {
    if (info?.organizations?.length === 1) {
      setOrgId(info.organizations[0].id);
    }
  }, [info]);

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
    if (!orgId) {
      setActionError("Please select an organization");
      return;
    }
    setSubmitting(true);
    setActionError("");
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
        setActionError(res.message || "Authorization failed");
        setSubmitting(false);
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
    }
  }, [apiCall, orgId, query]);

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

  const claimedName = info?.client?.clientName;
  const redirectTarget = describeRedirectTarget(info?.redirectUri);
  const showDetails = !!info?.client && !error;

  return (
    <ConsentPageWrapper>
      {showDetails ? (
        // `as="div"` rather than `as="p"`: global Bootstrap styling puts a
        // margin on <p> that fights the explicit spacing here.
        <Flex direction="column" align="center" mb="5">
          <Heading as="h1" size="x-large" align="center" mb="1">
            {claimedName}
          </Heading>
          <Text as="div" size="large" color="text-mid" align="center" mb="2">
            is requesting access to your GrowthBook account
          </Text>
          <Text as="div" size="small" color="text-low" align="center">
            Name provided by the application. GrowthBook does not verify
            application identity.
          </Text>
        </Flex>
      ) : (
        <Heading as="h1" size="x-large" mb="4">
          Authorize Application
        </Heading>
      )}

      {error ? (
        <Callout status="error" mb="4">
          {error}
        </Callout>
      ) : null}

      {redirectTarget && !redirectTarget.isLocal ? (
        <Callout status="warning" mb="4">
          Your authorization code will be sent to{" "}
          <Text as="span" size="inherit" weight="semibold">
            {redirectTarget.host}
          </Text>
          . Continue only if you recognize that destination.
        </Callout>
      ) : null}

      {info && !error ? (
        <Frame>
          {info.user ? (
            <>
              <Flex align="center" gap="3">
                <UserAvatar
                  size="md"
                  variant="soft"
                  color="gray"
                  name={info.user.name}
                  email={info.user.email}
                />
                <Box style={{ minWidth: 0 }}>
                  <Text as="div" size="small" color="text-mid">
                    Signed in as
                  </Text>
                  <Text
                    as="div"
                    size="medium"
                    weight="medium"
                    overflowWrap="anywhere"
                  >
                    {info.user.email}
                  </Text>
                </Box>
              </Flex>
              <Separator size="4" my="4" />
            </>
          ) : null}

          {info.organizations && info.organizations.length > 0 ? (
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
          ) : (
            <Callout status="warning">
              You are not a member of any organization.
            </Callout>
          )}
        </Frame>
      ) : null}

      <Frame>
        <Text as="div" size="medium" weight="semibold" mb="3">
          What this allows
        </Text>
        <Flex direction="column" gap="3">
          <AccessItem icon={<PiUserCircle size={16} />}>
            Acting as you in the selected organization, with the same
            permissions you have in GrowthBook.
          </AccessItem>
          <AccessItem icon={<PiKey size={16} />}>
            Access through the GrowthBook API on your behalf. Your password is
            never shared.
          </AccessItem>
          <AccessItem icon={<PiArrowCounterClockwise size={16} />}>
            Access continues until you revoke it from{" "}
            <Link href="/account/personal-access-tokens">
              Personal Access Tokens
            </Link>
            .
          </AccessItem>
        </Flex>
      </Frame>

      <Flex gap="3">
        <Button
          variant="soft"
          color="gray"
          size="md"
          onClick={deny}
          disabled={submitting}
          style={{ flex: 1 }}
        >
          Deny
        </Button>
        <Button
          size="md"
          onClick={approve}
          disabled={submitting || !orgId || !!error}
          loading={submitting}
          style={{ flex: 1 }}
        >
          Authorize
        </Button>
      </Flex>
    </ConsentPageWrapper>
  );
}

// Authenticated page, but do not force an org context — the user picks org here.
OAuthAuthorizePage.noOrganization = true;
OAuthAuthorizePage.liteLayout = true;
