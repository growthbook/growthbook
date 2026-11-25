import { PiCaretRight, PiSealQuestion } from "react-icons/pi";
import { Box, Card, Flex, Heading, Separator, Text } from "@radix-ui/themes";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useUser } from "@/services/UserContext";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PaidFeatureBadge from "./PaidFeatureBadge";

interface Props {
  setUpgradeModal: (open: boolean) => void;
  type: "get-started" | "features" | "experiments" | "imports" | "data-source";
}

const DocumentationSidebar = ({
  setUpgradeModal,
  type,
}: Props): React.ReactElement => {
  const { t } = useLingui();
  const { accountPlan, organization } = useUser();

  const permissionsUtil = usePermissionsUtil();
  const canUpgrade =
    accountPlan !== "enterprise" &&
    permissionsUtil.canManageBilling() &&
    !organization.isVercelIntegration;

  return (
    <Card style={{ padding: "var(--space-5)" }}>
      <SidebarHeading>
        <Trans>WHAT&apos;S NEW</Trans>
      </SidebarHeading>
      <Flex direction="column" gapY="3">
        <AIVisualEditorCallout />
        <LinkItem href="https://www.growthbook.io/blog/growthbook-version-5-2?utm_source=product&utm_medium=in-app&utm_campaign=release-5-2">
          <Trans>5.2 Feature Highlights</Trans>
        </LinkItem>
        <LinkItem href="https://docs.growthbook.io/integrations/ai-agents/agent-skills/">
          <Trans>Agent Skills</Trans>
        </LinkItem>
      </Flex>
      <Separator size="4" my="5" />
      <SidebarHeading>
        <Trans>RESOURCES</Trans>
      </SidebarHeading>
      <Flex direction="column" gapY="3">
        {getLinksFor(type, organization.isVercelIntegration)}
      </Flex>
      <Separator size="4" my="5" />
      <SidebarHeading>
        <Trans>QUESTIONS?</Trans>
      </SidebarHeading>
      <Flex direction="column" gapY="3">
        <LinkItem href="https://slack.growthbook.io/?ref=getstarted">
          <img
            src="/images/get-started/slack-logo.svg"
            alt={t`Slack Logo`}
            style={{ width: "18px", height: "18px" }}
          />
          <Text ml="1" style={{ verticalAlign: "middle" }}>
            <Trans>Community</Trans>
          </Text>
        </LinkItem>

        <LinkItem href="https://docs.growthbook.io/faq">
          <PiSealQuestion style={{ width: "20px", height: "20px" }} />
          <Text ml="1" style={{ verticalAlign: "middle" }}>
            <Trans>GrowthBook FAQs</Trans>
          </Text>
        </LinkItem>
      </Flex>

      {canUpgrade && (
        <Button
          mt="3"
          size="md"
          onClick={() => {
            setUpgradeModal(true);
          }}
          style={{ width: "100%" }}
        >
          <Trans>Upgrade</Trans>
        </Button>
      )}
    </Card>
  );
};

function AIVisualEditorCallout(): React.ReactElement | null {
  const { t } = useLingui();
  const enabled = useFeatureIsOn("ai-visual-editor-callout");

  if (!enabled) {
    return null;
  }

  return (
    <Link
      href="https://www.growthbook.io/events/visual-editor-early-access?utm_source=users&utm_medium=platform&utm_campaign=enablement-session-visual-editor"
      target="_blank"
      rel="noreferrer"
      underline="none"
      style={{ display: "block" }}
    >
      <Callout status="info" icon={null}>
        <Flex justify="start" mb="2">
          <Badge
            label={t`Early access`}
            color="violet"
            variant="soft"
            radius="full"
            size="sm"
          />
        </Flex>
        <Flex align="center" gap="3">
          <Box flexGrow="1" style={{ minWidth: 0, lineHeight: 1.45 }}>
            <Heading
              as="h6"
              size="2"
              mb="1"
              style={{ color: "var(--gray-12)", whiteSpace: "nowrap" }}
            >
              <Trans>AI Visual Editor</Trans>
            </Heading>
            <Text
              as="div"
              size="1"
              style={{ color: "var(--gray-11)", whiteSpace: "nowrap" }}
            >
              <Trans>Get early access June 22</Trans>
            </Text>
          </Box>
          <PiCaretRight
            size={16}
            style={{ color: "var(--gray-9)", flexShrink: 0 }}
          />
        </Flex>
      </Callout>
    </Link>
  );
}

function SidebarHeading({ children }: { children: React.ReactNode }) {
  return (
    <Heading as="h6" size="1" mb="2">
      {children}
    </Heading>
  );
}

function LinkItem(
  props: React.ComponentProps<typeof Link>,
): React.ReactElement {
  return (
    <Link
      color="dark"
      weight="medium"
      underline="none"
      target="_blank"
      rel="noreferrer"
      {...props}
    >
      {props.children}
    </Link>
  );
}

function getLinksFor(
  type: Props["type"],
  isVercelIntegration?: boolean,
): JSX.Element {
  switch (type) {
    case "get-started":
    case "data-source":
      if (isVercelIntegration) {
        return (
          <>
            <LinkItem href="https://docs.growthbook.io/integrations/vercel">
              <Trans>Vercel Integration Docs</Trans>
            </LinkItem>
            <LinkItem href="https://github.com/growthbook/growthbook/releases/tag/v5.2.0">
              <Trans>5.2 Release Notes</Trans>
            </LinkItem>
            <LinkItem href="https://docs.growthbook.io/">
              <Trans>Docs</Trans>
            </LinkItem>
            <LinkItem href="https://www.growthbook.io/pricing">
              <Trans>Premium Features</Trans>
            </LinkItem>
          </>
        );
      }

      return (
        <>
          <LinkItem href="https://docs.growthbook.io/">
            <Trans>Docs</Trans>
          </LinkItem>
          <LinkItem href="https://github.com/growthbook/growthbook/releases/tag/v5.2.0">
            <Trans>5.2 Release Notes</Trans>
          </LinkItem>
          <LinkItem href="https://www.growthbook.io/pricing">
            <Trans>Premium Features</Trans>
          </LinkItem>
        </>
      );

    case "features":
      return (
        <>
          <LinkItem href="https://docs.growthbook.io/lib/">
            <Trans>GrowthBook SDK</Trans>
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/features/basics">
            <Trans>Feature Flag Basics</Trans>
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/features/targeting">
            <Trans>Targeting Attributes</Trans>
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/warehouses">
            <Trans>Connect Your Data Source</Trans>
          </LinkItem>
        </>
      );

    case "experiments":
      return (
        <>
          <LinkItem href="https://docs.growthbook.io/experiments">
            <Trans>Running Experiments</Trans>
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/app/sticky-bucketing">
            <Trans>Sticky Bucketing</Trans>
            <PaidFeatureBadge commercialFeature="sticky-bucketing" mx="2" />
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/app/visual">
            <Trans>Visual Editor</Trans>
            <PaidFeatureBadge commercialFeature="visual-editor" mx="2" />
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/app/url-redirects">
            <Trans>URL Redirects</Trans>
            <PaidFeatureBadge commercialFeature="redirects" mx="2" />
          </LinkItem>
        </>
      );

    case "imports":
      return (
        <>
          <LinkItem href="https://docs.growthbook.io/warehouses">
            <Trans>Connect to Your Data Warehouse</Trans>
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/app/fact-tables">
            <Trans>Fact Tables</Trans>
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/app/data-pipeline">
            <Trans>Data Pipeline Mode</Trans>
            <PaidFeatureBadge commercialFeature="pipeline-mode" mx="2" />
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/app/experiment-results">
            <Trans>Experiment Results</Trans>
          </LinkItem>
        </>
      );
  }
}

export default DocumentationSidebar;
