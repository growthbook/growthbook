import { useRef, useState } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import { Box, Flex } from "@radix-ui/themes";
import type { SlackLinkConsent } from "shared/validators";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import RadioGroup from "@/ui/RadioGroup";
import Link from "@/ui/Link";

export default function SlackLinkPage() {
  const router = useRouter();
  const { apiCall, orgId, setOrgId } = useAuth();
  const { name, email } = useUser();
  const state =
    typeof router.query.state === "string" ? router.query.state : "";
  // POST keeps the consent token out of API query strings and access logs.
  const { data, error, mutate } = useSWR<SlackLinkConsent, Error>(
    state && orgId ? ["slack-link-consent", state, orgId, email] : null,
    () =>
      apiCall("/integrations/slack/link/consent", {
        method: "POST",
        body: JSON.stringify({ state }),
      }),
  );
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [linkedOrg, setLinkedOrg] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const selected =
    data?.organizations.find((org) => org.id === selectedOrgId) ??
    (data?.organizations.length === 1 ? data.organizations[0] : null);

  const onConfirm = async () => {
    if (inFlight.current) return;
    if (!selected) {
      setSubmitError("Choose the organization you want to link.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setSubmitError(null);
    try {
      await apiCall("/integrations/slack/link", {
        method: "POST",
        body: JSON.stringify({ state, organizationId: selected.id }),
      });
      setLinkedOrg({ id: selected.id, name: selected.name });
      void mutate();
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : "Could not link your Slack account.",
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <Flex
      align="center"
      justify="center"
      px="4"
      py="6"
      style={{ minHeight: "70vh" }}
    >
      <Box style={{ maxWidth: 560, width: "100%" }}>
        <Flex direction="column" gap="4">
          <Heading as="h1" size="lg">
            Link Your Slack Account
          </Heading>
          {!state ? (
            <Callout status="error">
              Missing link token. Send &quot;link account&quot; to GrowthBook in
              Slack for a fresh link.
            </Callout>
          ) : linkedOrg ? (
            <>
              <Callout status="success">
                Your Slack account is linked to {linkedOrg.name} as {email}. You
                can return to Slack.
              </Callout>
              <Link
                href={`/account/slack?org=${encodeURIComponent(linkedOrg.id)}`}
                onClick={() => setOrgId?.(linkedOrg.id)}
              >
                Manage my Slack links
              </Link>
              {(data?.organizations.length ?? 0) > 1 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setLinkedOrg(null);
                    setSelectedOrgId(null);
                  }}
                >
                  Link another organization
                </Button>
              )}
            </>
          ) : error ? (
            <Callout status="error">{error.message}</Callout>
          ) : !data ? (
            <LoadingSpinner />
          ) : (
            <>
              <Text as="p">
                Link Slack user {data.slackUserId} in {data.teamName} to your
                GrowthBook account. The assistant will use your permissions in
                the organization you select.
              </Text>
              <Box
                p="4"
                style={{ border: "1px solid var(--slate-a5)", borderRadius: 8 }}
              >
                <Text as="p" size="sm" color="text-mid">
                  GrowthBook account
                </Text>
                <Text as="p" weight="semibold">
                  {name ? `${name} (${email})` : email}
                </Text>
                <Text as="p" size="sm" color="text-mid">
                  To use a different account, sign out and reopen this link.
                </Text>
              </Box>
              {data.organizations.length === 0 ? (
                <Callout status="warning">
                  Your account is not a member of an organization connected to
                  this Slack workspace.
                </Callout>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onConfirm();
                  }}
                >
                  <Flex direction="column" gap="4">
                    <fieldset
                      disabled={saving}
                      style={{ border: 0, padding: 0, margin: 0 }}
                    >
                      <legend>
                        <Text weight="semibold" mb="2">
                          GrowthBook organization
                        </Text>
                      </legend>
                      <RadioGroup
                        value={selected?.id || ""}
                        setValue={(id) => {
                          setSelectedOrgId(id);
                          setSubmitError(null);
                        }}
                        options={data.organizations.map((org) => ({
                          value: org.id,
                          label: org.name,
                          description:
                            org.linkedAccount === "other"
                              ? "Linked to another GrowthBook account"
                              : org.linkedAccount === "current"
                                ? "Linked to this account"
                                : "Not linked",
                        }))}
                      />
                    </fieldset>
                    <Text as="p" size="sm" color="text-mid">
                      Each organization requires a separate link. Linking here
                      leaves your links in other organizations unchanged.
                    </Text>
                    {selected?.linkedAccount && (
                      <Callout status="warning">
                        This replaces your existing link in {selected.name}.
                        Approvals from the previous link will no longer work.
                      </Callout>
                    )}
                    {submitError && (
                      <div role="alert">
                        <Callout status="error">{submitError}</Callout>
                      </div>
                    )}
                    <Button type="submit" disabled={saving}>
                      {saving
                        ? "Linking…"
                        : selected?.linkedAccount
                          ? "Replace linked account"
                          : "Link my account"}
                    </Button>
                  </Flex>
                </form>
              )}
            </>
          )}
        </Flex>
      </Box>
    </Flex>
  );
}
