import { Flex } from "@radix-ui/themes";
import { Permissions } from "shared/permissions";
import { UserContext } from "@/services/UserContext";
import { StoryMeta } from "@/ui/storyMeta";
import PremiumCallout from "./PremiumCallout";

export const meta: StoryMeta = {
  name: "PremiumCallout",
  category: "feedback",
  status: "stable",
  summary:
    "A callout that promotes a commercial feature and links to upgrade, optionally dismissible per user.",
  useWhen: [
    "Tell users a feature needs a higher plan.",
    "Nudge an upgrade next to the gated feature.",
  ],
  avoidWhen: [
    {
      reason: "The message is not about a paid feature.",
      use: "Callout",
    },
  ],
  related: ["Callout"],
};

export default function PremiumCalloutStories() {
  return (
    <UserContext.Provider
      // @ts-expect-error - this is a mock
      value={{
        hasCommercialFeature: (feature) => feature === "multi-armed-bandits",
        commercialFeatureLowestPlan: {
          "visual-editor": "pro",
          "custom-roles": "enterprise",
          "multi-armed-bandits": "pro",
        } as const,
        users: new Map(),
        organization: {},
        permissionsUtil: new Permissions({
          global: {
            permissions: {
              manageBilling: true,
            },
            limitAccessByEnvironment: false,
            environments: [],
          },
          projects: {},
        }),
      }}
    >
      <Flex direction="column" gap="3">
        <PremiumCallout
          commercialFeature="visual-editor"
          id="design-system-pro"
        >
          This Pro feature unlocks extra power and speed.
        </PremiumCallout>
        <PremiumCallout
          commercialFeature="custom-roles"
          id="design-system-enterprise"
        >
          This Enterprise feature gives you enhanced security and compliance.
        </PremiumCallout>
        <PremiumCallout
          commercialFeature="multi-armed-bandits"
          id="design-system-dismissible"
          docSection="bandits"
          dismissible={true}
          renderWhenDismissed={(undismiss) => (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                undismiss();
              }}
            >
              Un-dismiss
            </a>
          )}
        >
          You already have access to this premium feature. This gives you a docs
          link and is dismissible.
        </PremiumCallout>
      </Flex>
    </UserContext.Provider>
  );
}
