import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import { Box, Flex } from "@radix-ui/themes";
import { ago, date } from "shared/dates";
import {
  ApiFlagImport,
  FlagImportFlag,
  FlagImportResult,
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
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LoadingOverlay from "@/components/LoadingOverlay";
import Welcome from "@/components/Auth/Welcome";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import LinkButton from "@/ui/LinkButton";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

const NO_PROJECT = "__none__";

const VALUE_TYPE_LABEL: Record<FlagImportFlag["valueType"], string> = {
  boolean: "Boolean",
  string: "String",
  number: "Number",
  json: "JSON",
};

const RESULT_GROUPS: { status: FlagImportResult["status"]; label: string }[] = [
  { status: "created", label: "Created" },
  { status: "exists", label: "Already existed" },
  { status: "skipped", label: "Skipped" },
  { status: "failed", label: "Failed" },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function fetchFlagImport(token: string): Promise<ApiFlagImport | null> {
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

function Page({ children }: { children: ReactNode }) {
  return (
    <Box maxWidth="520px" mx="auto" my="5" px="4">
      <Frame>{children}</Frame>
    </Box>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Flex gap="3" justify="between" align="start">
      <Box minWidth="0">{label}</Box>
      <Box flexShrink="0">{children}</Box>
    </Flex>
  );
}

function FlagRow({ flag }: { flag: FlagImportFlag }) {
  const meta = [VALUE_TYPE_LABEL[flag.valueType]];
  if (flag.rules > 0) meta.push(plural(flag.rules, "rule"));
  return (
    <Box>
      <Row
        label={
          <Text mono overflowWrap="anywhere">
            {flag.key}
          </Text>
        }
      >
        {flag.importable ? (
          <Text color="text-mid">{meta.join(" · ")}</Text>
        ) : (
          <Badge label="Not imported" color="gray" />
        )}
      </Row>
      {!flag.importable && flag.reason && (
        <Text as="div" color="text-mid">
          {flag.reason}
        </Text>
      )}
    </Box>
  );
}

function ClaimedResults({ results }: { results: FlagImportResult[] }) {
  const main = results.filter(
    (r) => r.kind === "feature" || r.kind === "experiment",
  );
  const extras = results
    .filter(
      (r) =>
        (r.kind === "environment" || r.kind === "attribute") &&
        r.status === "created",
    )
    .map((r) => `${r.kind} ${r.key}`);
  return (
    <Flex direction="column" gap="4" mb="4">
      {RESULT_GROUPS.map(({ status, label }) => {
        const rows = main.filter((r) => r.status === status);
        if (!rows.length) return null;
        return (
          <Box key={status}>
            <Text as="div" weight="medium" mb="1">
              {label}
            </Text>
            <Flex direction="column" gap="1">
              {rows.map((r) => (
                <Box key={`${r.kind}:${r.key}`}>
                  <Text as="div" mono overflowWrap="anywhere">
                    {r.key}
                  </Text>
                  {r.message && (
                    <Text as="div" color="text-mid">
                      {r.message}
                    </Text>
                  )}
                </Box>
              ))}
            </Flex>
          </Box>
        );
      })}
      {extras.length > 0 && (
        <Text as="p" color="text-mid">
          Also created: {extras.join(", ")}
        </Text>
      )}
    </Flex>
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
  const { ready: definitionsReady, projects } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const restApiCall = useRestApiCall();

  const [showLogin, setShowLogin] = useState<{
    newInstallation: boolean;
  } | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [projectChoice, setProjectChoice] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimedOrgId, setClaimedOrgId] = useState<string | null>(null);

  useEffect(() => {
    trackPageView("/claim");
  }, []);

  const {
    data: flagImport,
    error: loadError,
    isLoading,
    mutate,
  } = useSWR<ApiFlagImport | null, Error>(
    token ? `flag-import::${token}` : null,
    () => fetchFlagImport(token),
    { revalidateOnFocus: false },
  );

  const claim = useCallback(
    async (project?: string) => {
      const res = await restApiCall(postFlagImportClaimValidator, {
        params: { token },
        body: project ? { project } : {},
      });
      setClaimedOrgId(orgId);
      await mutate(res.flagImport, { revalidate: false });
    },
    [restApiCall, token, orgId, mutate],
  );

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
      <Page>
        <Callout status="error">{loadError.message}</Callout>
      </Page>
    );
  }

  if (!flagImport) {
    return (
      <Page>
        <Heading as="h1" size="lg" mb="2">
          This Link Has Expired
        </Heading>
        <Text as="p" color="text-mid" mb="4">
          Uploads are kept for 24 hours. Send the file again to get a new link.
        </Text>
        <Link href="/">Go to GrowthBook</Link>
      </Page>
    );
  }

  if (flagImport.status === "claimed") {
    return (
      <Page>
        <Heading as="h1" size="lg" mb="1">
          Feature Flags Imported
        </Heading>
        <Text as="p" color="text-mid" mb="4">
          {[
            flagImport.name,
            flagImport.claimed ? `Imported ${ago(flagImport.claimed.at)}` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <ClaimedResults results={flagImport.claimed?.results ?? []} />
        <Flex justify="end">
          {claimedOrgId ? (
            <Button
              onClick={() => {
                try {
                  localStorage.setItem(
                    "gb-last-picked-org",
                    JSON.stringify(claimedOrgId),
                  );
                } catch {
                  // the org query param still switches the workspace
                }
                window.location.assign(
                  `/features?org=${encodeURIComponent(claimedOrgId)}`,
                );
              }}
            >
              Go to Feature Flags
            </Button>
          ) : (
            <LinkButton href="/features">Go to Feature Flags</LinkButton>
          )}
        </Flex>
      </Page>
    );
  }

  if (isAuthenticated && !userReady) {
    return <LoadingOverlay />;
  }

  const importable = flagImport.flags.filter((f) => f.importable).length;
  const experimentWarnings = [
    ...new Set(
      flagImport.warnings
        .filter((w) => w.path.startsWith("experiments["))
        .map((w) => w.message),
    ),
  ];
  const meta = [
    flagImport.name,
    `Sent ${ago(flagImport.dateCreated)}${
      flagImport.agent ? ` by ${flagImport.agent}` : ""
    }`,
    `Expires ${date(flagImport.expiresAt)}`,
  ].filter(Boolean);

  const orgLoaded = !!orgId && organization?.id === orgId && definitionsReady;
  const projectOptions = orgLoaded
    ? projects.filter((p) => permissionsUtil.canViewFeatureModal(p.id))
    : [];
  const allowNoProject = permissionsUtil.canViewFeatureModal();
  const project =
    projectChoice && projectOptions.some((p) => p.id === projectChoice)
      ? projectChoice
      : allowNoProject
        ? NO_PROJECT
        : (projectOptions[0]?.id ?? NO_PROJECT);
  const importLabel = `Import ${plural(importable, "Feature Flag")}`;

  return (
    <Page>
      <Heading as="h1" size="lg" mb="1">
        Import {plural(flagImport.flags.length, "Feature Flag")}
      </Heading>
      <Text as="p" color="text-mid" mb="4">
        {meta.join(" · ")}
      </Text>
      <Flex direction="column" gap="2" mb="4">
        {flagImport.flags.map((flag) => (
          <FlagRow key={flag.key} flag={flag} />
        ))}
        {flagImport.summary.environments.length > 0 && (
          <Row label={<Text color="text-mid">Environments</Text>}>
            <Text>{flagImport.summary.environments.join(", ")}</Text>
          </Row>
        )}
      </Flex>
      {experimentWarnings.map((message) => (
        <Callout key={message} status="warning" mb="4">
          {message}
        </Callout>
      ))}

      {!isAuthenticated ? (
        <>
          {authError && (
            <Callout status="error" mb="3">
              {authError}
            </Callout>
          )}
          <Flex justify="end" align="center" gap="3">
            {isCloud() ? (
              <>
                <Button
                  variant="ghost"
                  setError={setAuthError}
                  onClick={() => startAuth(false)}
                >
                  Sign in
                </Button>
                <Button setError={setAuthError} onClick={() => startAuth(true)}>
                  Sign up to import
                </Button>
              </>
            ) : (
              <Button setError={setAuthError} onClick={() => startAuth(false)}>
                Sign in to import
              </Button>
            )}
          </Flex>
        </>
      ) : (
        <>
          {organizations.length > 0 ? (
            <Flex direction="column" gap="3" mb="4">
              <Select
                label="Workspace"
                value={orgId ?? undefined}
                setValue={(id) => {
                  setProjectChoice(null);
                  setOrgId?.(id);
                }}
              >
                {organizations.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </Select>
              {projectOptions.length > 0 && (
                <Select
                  label="Project"
                  value={project}
                  setValue={setProjectChoice}
                >
                  {allowNoProject && (
                    <SelectItem value={NO_PROJECT}>None</SelectItem>
                  )}
                  {projectOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </Select>
              )}
            </Flex>
          ) : (
            <TextField
              label="Workspace name"
              autoFocus
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              mb="4"
            />
          )}
          {claimError && (
            <Callout status="error" mb="3">
              {claimError}
            </Callout>
          )}
          <Flex justify="end">
            {organizations.length > 0 ? (
              <Button
                setError={setClaimError}
                disabled={!importable || !orgLoaded}
                onClick={() =>
                  claim(project === NO_PROJECT ? undefined : project)
                }
              >
                {importLabel}
              </Button>
            ) : (
              <Button
                setError={setClaimError}
                disabled={!importable || !workspaceName.trim()}
                onClick={createWorkspaceAndClaim}
              >
                {importLabel}
              </Button>
            )}
          </Flex>
        </>
      )}
    </Page>
  );
};

ClaimPage.preAuth = true;
ClaimPage.progressiveAuth = true;
ClaimPage.progressiveAuthTopNav = true;

export default ClaimPage;
