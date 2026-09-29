import { useState } from "react";
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
  const organization = data?.organization;

  const onConfirm = async () => {
    if (saving || !organization) return;
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
                Your Slack account is now linked to {linkedOrg.name} as {email}.
                You can now close this tab and return to Slack.
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
                Link Slack user ({data.slackUserId}) in Slack team{" "}
                {data.teamName} to this GrowthBook account in organization{" "}
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
                      in {data.organization.name}.
                    </Callout>
                  )}
                  {submitError && (
                    <Callout status="error">{submitError}</Callout>
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
