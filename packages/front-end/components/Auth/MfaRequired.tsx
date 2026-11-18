import { Box, Flex } from "@radix-ui/themes";
import { safeLogout, useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { usingSSO } from "@/services/env";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import TopNavLite from "@/components/Layout/TopNavLite";
import MfaEnrollment from "./MfaEnrollment";

export default function MfaRequired() {
  const { mfaEnabled } = useUser();
  const { organizations, orgId, setOrgId } = useAuth();
  const otherOrgs = (organizations || []).filter((o) => o.id !== orgId);

  return (
    <div>
      <TopNavLite />
      <Box maxWidth="500px" mx="auto" mt="9" px="4">
        <Frame>
          <Heading as="h1" size="lg" mb="3">
            MFA Required
          </Heading>
          <Callout status="info" mb="3">
            {usingSSO()
              ? "Your organization requires multi-factor authentication (MFA). Log out, then sign in again using MFA with your identity provider."
              : mfaEnabled
                ? "Your organization requires multi-factor authentication (MFA). Log out, then log back in with a code from your authenticator app."
                : "Your organization requires multi-factor authentication (MFA). Set it up to continue."}
          </Callout>
          {!usingSSO() && !mfaEnabled && <MfaEnrollment />}
          <Flex justify="end" gap="3" mt="3">
            {otherOrgs.length > 0 && setOrgId && (
              <DropdownMenu
                trigger={<Button variant="ghost">Switch organization</Button>}
              >
                {otherOrgs.map((o) => (
                  <DropdownMenuItem
                    key={o.id}
                    onClick={() => {
                      setOrgId(o.id);
                      try {
                        localStorage.setItem("gb-last-picked-org", `"${o.id}"`);
                      } catch (e) {
                        // Only affects which org opens next time
                      }
                    }}
                  >
                    {o.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenu>
            )}
            <Button variant="ghost" onClick={safeLogout}>
              Log out
            </Button>
          </Flex>
        </Frame>
      </Box>
    </div>
  );
}
