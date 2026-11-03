import { Flex } from "@radix-ui/themes";
import { Permissions } from "shared/permissions";
import { UserContext } from "@/services/UserContext";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import PermissionBlocker from "@/ui/PermissionBlocker";
import PremiumCallout from "@/ui/PremiumCallout";
import Tooltip from "@/ui/Tooltip";
import { StoryMeta } from "@/ui/storyMeta";

export const meta: StoryMeta = {
  name: "Permission-gated action",
  category: "patterns",
  status: "stable",
  summary:
    "Decide before rendering whether the viewer can act. Hide actions they can never use, and disable the rest with a reason. Paid features get a `PremiumCallout`.",
  useWhen: [
    "A page-level create button the viewer can't use. Hide it.",
    "A row action the viewer can't use. Disable it and explain in a `Tooltip`.",
    "A blocked step inside a form. Explain it with `PermissionBlocker`.",
  ],
  avoidWhen: [
    {
      reason: "The note applies to everyone, not just this viewer.",
      use: "HelperText",
    },
  ],
  related: ["PermissionBlocker", "PremiumCallout", "Tooltip", "Button"],
  examples: [
    "pages/constants/index.tsx",
    "components/SavedGroups/RemoteGroups.tsx",
    "components/Features/KillSwitchModal.tsx",
  ],
};

export default function PermissionGatedActionStory() {
  // In real code these come from usePermissionsUtil() and useUser().
  const canCreate = false;
  const canPublish = false;

  return (
    <UserContext.Provider
      // @ts-expect-error - this is a mock
      value={{
        hasCommercialFeature: () => false,
        commercialFeatureLowestPlan: { "custom-roles": "enterprise" } as const,
        users: new Map(),
        organization: {},
        permissionsUtil: new Permissions({
          global: {
            permissions: { manageBilling: true },
            limitAccessByEnvironment: false,
            environments: [],
          },
          projects: {},
        }),
      }}
    >
      <Flex direction="column" gap="5" align="start">
        <Flex direction="column" gap="2" align="start">
          <Heading as="h4" size="sm">
            Hidden
          </Heading>
          {canCreate ? <Button>Add Constant</Button> : null}
        </Flex>
        <Flex direction="column" gap="2" align="start">
          <Heading as="h4" size="sm">
            Disabled With a Tooltip
          </Heading>
          <Tooltip
            content="You do not have permission to create Saved Groups."
            enabled={!canCreate}
          >
            {/* A disabled button gets no hover events, so the tooltip wraps a span. */}
            <span>
              <Button disabled={!canCreate}>Add Saved Group</Button>
            </span>
          </Tooltip>
        </Flex>
        <Flex direction="column" gap="2" align="start">
          <Heading as="h4" size="sm">
            Disabled With a PermissionBlocker
          </Heading>
          <PermissionBlocker>
            You don&apos;t have permission to publish to production.
          </PermissionBlocker>
          <Button disabled={!canPublish}>Publish</Button>
        </Flex>
        <Flex direction="column" gap="2" align="start">
          <Heading as="h4" size="sm">
            Premium Feature
          </Heading>
          <PremiumCallout
            commercialFeature="custom-roles"
            id="design-system-pattern-permission"
          >
            Custom roles are available on the Enterprise plan.
          </PremiumCallout>
        </Flex>
      </Flex>
    </UserContext.Provider>
  );
}
