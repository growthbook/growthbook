import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import { Box, Flex } from "@radix-ui/themes";
import { date } from "shared/dates";
import {
  ApiFlagImport,
  ApiFlagImportStatus,
  getFlagImportDetailsValidator,
  getFlagImportValidator,
  postFlagImportClaimValidator,
} from "shared/validators";
import type { CreateOrganizationPostBody } from "shared/types/organization";
import type {
  IdTokenResponse,
  UnauthenticatedResponse,
} from "shared/types/sso-connection";
import {
  savePostAuthRedirectPath,
  redirectWithTimeout,
  useAuth,
} from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getApiHost, isCloud } from "@/services/env";
import track, { trackPageView } from "@/services/track";
import { useRestApiCall } from "@/services/restApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import Welcome from "@/components/Auth/Welcome";
import ImportFlow, {
  ImportDone,
  ImportHero,
} from "@/components/FlagImport/ImportFlow";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import LinkButton from "@/ui/LinkButton";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

async function fetchStatus(token: string): Promise<ApiFlagImportStatus | null> {
  const res = await fetch(
    `${getApiHost()}/api/v1/flag-imports/${encodeURIComponent(token)}`,
  );
  if (res.status === 404) return null;
  const json: unknown = await res.json();
  if (!res.ok) {
    const message =
      json && typeof json === "object" && "message" in json
        ? String(json.message)
        : "There was an error";
    throw new Error(message);
  }
  return getFlagImportValidator.responseSchema.parse(json).flagImport;
}

function Page({
  children,
  narrow = false,
}: {
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <Box maxWidth={narrow ? "520px" : "760px"} mx="auto" px="4" pt="6" pb="8">
      {narrow ? <Frame>{children}</Frame> : children}
    </Box>
  );
}

function LinkNote({ expiresAt }: { expiresAt: string }) {
  return (
    <Text as="p" size="sm" color="text-mid" align="center" mt="5" mb="0">
      This link works once · Expires {date(expiresAt)}
    </Text>
  );
}

const ClaimPage = (): React.ReactElement => {
  const router = useRouter();
  const token =
    typeof router.query.token === "string" ? router.query.token : "";
  const {
    apiCall,
    isAuthenticated,
    loading: authLoading,
    orgId,
    setOrgId,
    organizations = [],
  } = useAuth();
  const { ready: userReady, organization, updateUser } = useUser();
  const { ready: definitionsReady } = useDefinitions();
  const restApiCall = useRestApiCall();

  const [showLogin, setShowLogin] = useState<{
    newInstallation: boolean;
  } | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [namingWorkspace, setNamingWorkspace] = useState(false);
  const [claimed, setClaimed] = useState<{
    orgId: string;
    flagImport: ApiFlagImport;
  } | null>(null);

  useEffect(() => {
    trackPageView("/claim");
  }, []);

  const {
    data: status,
    error: loadError,
    isLoading,
    mutate: mutateStatus,
  } = useSWR<ApiFlagImportStatus | null, Error>(
    token ? `flag-import::${token}` : null,
    () => fetchStatus(token),
    { revalidateOnFocus: false },
  );

  const orgLoaded = !!orgId && organization?.id === orgId && definitionsReady;
  const {
    data: fetched,
    error: detailsError,
    isLoading: detailsLoading,
  } = useSWR<ApiFlagImport, Error>(
    isAuthenticated && orgLoaded && status && status.status !== "pending"
      ? `flag-import-details::${token}::${orgId}`
      : null,
    async () =>
      (await restApiCall(getFlagImportDetailsValidator, { params: { token } }))
        .flagImport,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const flagImport =
    claimed && claimed.orgId === orgId ? claimed.flagImport : fetched;

  const claim = useCallback(async () => {
    const res = await restApiCall(postFlagImportClaimValidator, {
      params: { token },
    });
    if (orgId) setClaimed({ orgId, flagImport: res.flagImport });
    await mutateStatus();
  }, [restApiCall, token, orgId, mutateStatus]);

  // A new workspace's claim waits until its id reaches the request headers
  const pendingClaim = useRef<{
    orgId: string;
    resolve: () => void;
    reject: (e: unknown) => void;
  } | null>(null);
  useEffect(() => {
    const pending = pendingClaim.current;
    if (!pending || pending.orgId !== orgId) return;
    pendingClaim.current = null;
    claim().then(pending.resolve, pending.reject);
  }, [orgId, claim]);

  const startAuth = async (signup: boolean) => {
    const res = await fetch(`${getApiHost()}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    const data: UnauthenticatedResponse | IdTokenResponse = await res.json();
    if ("token" in data) {
      window.location.reload();
    } else if ("redirectURI" in data) {
      savePostAuthRedirectPath();
      const url = new URL(data.redirectURI);
      if (signup) url.searchParams.set("screen_hint", "signup");
      await redirectWithTimeout(url.toString());
    } else if ("showLogin" in data) {
      setShowLogin({ newInstallation: data.newInstallation });
    } else {
      throw new Error("There was an error");
    }
  };

  const createWorkspaceAndClaim = async () => {
    const body: CreateOrganizationPostBody = { company: workspaceName.trim() };
    // Keeps this step on screen while the new workspace loads.
    setNamingWorkspace(true);
    const res = await apiCall<{ orgId: string }>("/organization", {
      method: "POST",
      body: JSON.stringify(body),
    });
    track("Create Organization");
    updateUser();
    await new Promise<void>((resolve, reject) => {
      pendingClaim.current = { orgId: res.orgId, resolve, reject };
      setOrgId?.(res.orgId);
    });
  };

  const goToFlags = () => {
    if (!orgId) {
      router.push("/features");
      return;
    }
    try {
      localStorage.setItem("gb-last-picked-org", JSON.stringify(orgId));
    } catch {
      // the org query param still switches the workspace
    }
    window.location.assign(`/features?org=${encodeURIComponent(orgId)}`);
  };

  if (showLogin) {
    return (
      <Welcome
        firstTime={showLogin.newInstallation}
        onSuccess={() => window.location.reload()}
      />
    );
  }

  if (!router.isReady || authLoading || isLoading) {
    return <LoadingOverlay />;
  }

  if (loadError) {
    return (
      <Page narrow>
        <Callout status="error">{loadError.message}</Callout>
      </Page>
    );
  }

  if (!status) {
    return (
      <Page narrow>
        <ImportHero title="This link has expired">
          Uploads are kept for 24 hours. Send the file again to get a new link.
        </ImportHero>
        <Flex justify="center">
          <LinkButton href="/">Go to GrowthBook</LinkButton>
        </Flex>
      </Page>
    );
  }

  const pending = status.status === "pending";

  if (!isAuthenticated) {
    return (
      <Page narrow>
        <ImportHero
          title={
            pending
              ? "Your Feature Flags are ready"
              : "This link was already claimed"
          }
        >
          {pending
            ? "Sign in or create a free account to bring them into GrowthBook."
            : "If you claimed it, sign in to pick up where you left off."}
        </ImportHero>
        {authError ? (
          <Callout status="error" mb="3">
            {authError}
          </Callout>
        ) : null}
        <Flex justify="center" align="center" gap="3" wrap="wrap">
          {pending && isCloud() ? (
            <>
              <Button setError={setAuthError} onClick={() => startAuth(true)}>
                Sign up to claim
              </Button>
              <Button
                variant="ghost"
                setError={setAuthError}
                onClick={() => startAuth(false)}
              >
                Sign in
              </Button>
            </>
          ) : (
            <Button setError={setAuthError} onClick={() => startAuth(false)}>
              {pending ? "Sign in to claim" : "Sign in"}
            </Button>
          )}
        </Flex>
        {pending ? <LinkNote expiresAt={status.expiresAt} /> : null}
      </Page>
    );
  }

  if (!userReady) {
    return <LoadingOverlay />;
  }

  if (flagImport?.status === "imported") {
    return (
      <Page>
        <ImportDone flagImport={flagImport} onGoToFlags={goToFlags} />
      </Page>
    );
  }

  if (flagImport?.status === "claimed" && flagImport.file) {
    return (
      <Page>
        <ImportFlow
          token={token}
          flagImport={flagImport}
          file={flagImport.file}
          onImported={(imported) => {
            if (orgId) setClaimed({ orgId, flagImport: imported });
            mutateStatus();
          }}
        />
      </Page>
    );
  }

  const workspaceSelect = (
    <Select
      label="Workspace"
      value={orgId ?? undefined}
      setValue={(id) => setOrgId?.(id)}
    >
      {organizations.map((o) => (
        <SelectItem key={o.id} value={o.id}>
          {o.name}
        </SelectItem>
      ))}
    </Select>
  );

  if (pending) {
    const hasWorkspace = organizations.length > 0 && !namingWorkspace;
    return (
      <Page narrow>
        <ImportHero
          title={hasWorkspace ? "Where should they go?" : "Name your workspace"}
        />
        {hasWorkspace ? (
          workspaceSelect
        ) : (
          <TextField
            label="Workspace name"
            autoFocus
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
          />
        )}
        {claimError ? (
          <Callout status="error" mt="3">
            {claimError}
          </Callout>
        ) : null}
        <Flex direction="column" mt="4">
          <Button
            setError={setClaimError}
            disabled={hasWorkspace ? !orgLoaded : !workspaceName.trim()}
            onClick={hasWorkspace ? claim : createWorkspaceAndClaim}
          >
            Claim your Feature Flags
          </Button>
        </Flex>
        <LinkNote expiresAt={status.expiresAt} />
      </Page>
    );
  }

  if (detailsLoading || (!!orgId && !orgLoaded)) {
    return <LoadingOverlay />;
  }

  // Claimed, but not by the workspace that's open.
  const elsewhere =
    !detailsError || /another workspace/i.test(detailsError.message);
  return (
    <Page narrow>
      <ImportHero title="This link was already claimed">
        {organizations.length > 1
          ? "Switch to the workspace that claimed it to continue."
          : null}
      </ImportHero>
      {organizations.length > 1 ? workspaceSelect : null}
      {!elsewhere && detailsError ? (
        <Callout status="error" mt="3">
          {detailsError.message}
        </Callout>
      ) : null}
    </Page>
  );
};

ClaimPage.preAuth = true;
ClaimPage.progressiveAuth = true;
ClaimPage.progressiveAuthTopNav = true;

export default ClaimPage;
