import { Box, Flex } from "@radix-ui/themes";
import { safeLogout, useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import TopNavLite from "@/components/Layout/TopNavLite";
import MfaEnrollment from "./MfaEnrollment";

export default function MfaRequired() {
  const { mfaEnabled, mfaManagedByIdp } = useUser();
  const { organizations, orgId, setOrgId } = useAuth();
  const otherOrgs = (organizations || []).filter((o) => o.id !== orgId);
  const canEnroll = !mfaManagedByIdp && !mfaEnabled;

  return (
    <div>
      <TopNavLite />
      <Box maxWidth="500px" mx="auto" mt="9" px="4">
        <Frame>
          <Heading as="h1" size="lg" mb="3">
            MFA Required
          </Heading>
          <Callout status="info" mb="3">
            {mfaManagedByIdp
              ? "Your organization requires multi-factor authentication (MFA). Log out, then sign in again using MFA with your identity provider."
              : mfaEnabled
                ? "Your organization requires multi-factor authentication (MFA). Log out, then log back in with a code from your authenticator app."
                : "Your organization requires multi-factor authentication (MFA). Set it up to continue."}
          </Callout>
          {canEnroll && <MfaEnrollment />}
          <Flex justify="end" gap="3" mt="3">
            {otherOrgs.length > 0 && setOrgId && (
              <DropdownMenu
                trigger={<Button variant="ghost">Switch organization</Button>}
              >
                <DropdownMenuLabel>Organization</DropdownMenuLabel>
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
            {/* Logging out is the only way forward unless they can enroll here */}
            <Button
              variant={canEnroll ? "ghost" : "solid"}
              onClick={safeLogout}
            >
              Log out
            </Button>
          </Flex>
        </Frame>
      </Box>
    </div>
  );
}
