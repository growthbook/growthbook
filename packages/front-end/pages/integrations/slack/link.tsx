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
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Link from "@/ui/Link";

export default function SlackLinkPage() {
  const router = useRouter();
  const { apiCall, orgId, setOrgId } = useAuth();
  const { name, email } = useUser();
  const state =
    typeof router.query.state === "string" ? router.query.state : "";
  // POST keeps the consent token out of API query strings and access logs.
  const { data, error } = useSWR<SlackLinkConsent, Error>(
    state && orgId ? ["slack-link-consent", state, orgId, email] : null,
    () =>
      apiCall("/integrations/slack/link/consent", {
        method: "POST",
        body: JSON.stringify({ state }),
      }),
  );
  const [linkedOrg, setLinkedOrg] = useState<Pick<
    SlackLinkConsent["organization"],
    "id" | "name"
  > | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const organization = data?.organization;

  const onConfirm = async () => {
    if (inFlight.current || !organization) return;
    inFlight.current = true;
    setSaving(true);
    setSubmitError(null);
    try {
      await apiCall("/integrations/slack/link", {
        method: "POST",
        body: JSON.stringify({ state, organizationId: organization.id }),
      });
      setLinkedOrg({ id: organization.id, name: organization.name });
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
                Your Slack account is linked to {linkedOrg.name} as {email}.
                Return to Slack and send your question again.
              </Callout>
              <Link
                href={`/account/slack?org=${encodeURIComponent(linkedOrg.id)}`}
                onClick={() => setOrgId?.(linkedOrg.id)}
              >
                Manage my Slack links
              </Link>
            </>
          ) : error ? (
            <Callout status="error">{error.message}</Callout>
          ) : !data ? (
            <LoadingSpinner />
          ) : (
            <>
              <Text as="p">
                Link Slack user {data.slackUserId} in {data.teamName} to your
                GrowthBook account. The assistant will use your permissions in{" "}
                {data.organization.name}.
              </Text>
              <Frame mb="0" px="4" py="4">
                <Text as="p" size="sm" color="text-mid">
                  GrowthBook account
                </Text>
                <Text as="p" weight="semibold">
                  {name ? `${name} (${email})` : email}
                </Text>
                <Text as="p" size="sm" color="text-mid">
                  To use a different account, sign out and reopen this link.
                </Text>
              </Frame>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void onConfirm();
                }}
              >
                <Flex direction="column" gap="4">
                  <Box>
                    <Text as="p" size="sm" color="text-mid">
                      GrowthBook organization
                    </Text>
                    <Text as="p" weight="semibold">
                      {data.organization.name}
                    </Text>
                  </Box>
                  {data.organization.linkedAccount && (
                    <Callout status="warning">
                      This replaces the link to{" "}
                      {data.organization.linkedAccount === "other"
                        ? "another GrowthBook account"
                        : "your GrowthBook account"}{" "}
                      in {data.organization.name}. Approvals from the previous
                      link will no longer work.
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
                      : data.organization.linkedAccount
                        ? "Replace linked account"
                        : "Link my account"}
                  </Button>
                </Flex>
              </form>
            </>
          )}
        </Flex>
      </Box>
    </Flex>
  );
}
