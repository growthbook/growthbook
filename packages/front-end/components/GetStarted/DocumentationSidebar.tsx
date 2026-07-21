import { PiCaretRight, PiSealQuestion } from "react-icons/pi";
import { Box, Card, Flex, Heading, Separator, Text } from "@radix-ui/themes";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
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
  const { accountPlan, organization } = useUser();

  const permissionsUtil = usePermissionsUtil();
  const canUpgrade =
    accountPlan !== "enterprise" &&
    permissionsUtil.canManageBilling() &&
    !organization.isVercelIntegration;

  return (
    <Card style={{ padding: "var(--space-5)" }}>
      <SidebarHeading>WHAT&apos;S NEW</SidebarHeading>
      <Flex direction="column" gapY="3">
        <AIVisualEditorCallout />
        <LinkItem href="https://docs.growthbook.io/integrations/ai-agents/agent-skills/">
          Agent Skills
        </LinkItem>
      </Flex>
      <Separator size="4" my="5" />
      <SidebarHeading>RESOURCES</SidebarHeading>
      <Flex direction="column" gapY="3">
        {getLinksFor(type, organization.isVercelIntegration)}
      </Flex>
      <Separator size="4" my="5" />
      <SidebarHeading>QUESTIONS?</SidebarHeading>
      <Flex direction="column" gapY="3">
        <LinkItem href="https://slack.growthbook.io/?ref=getstarted">
          <img
            src="/images/get-started/slack-logo.svg"
            alt="Slack Logo"
            style={{ width: "18px", height: "18px" }}
          />
          <Text ml="1" style={{ verticalAlign: "middle" }}>
            Community
          </Text>
        </LinkItem>

        <LinkItem href="https://docs.growthbook.io/faq">
          <PiSealQuestion style={{ width: "20px", height: "20px" }} />
          <Text ml="1" style={{ verticalAlign: "middle" }}>
            GrowthBook FAQs
          </Text>
        </LinkItem>
      </Flex>

      {canUpgrade && (
        <Button
          mt="3"
          size="sm"
          onClick={() => {
            setUpgradeModal(true);
          }}
          style={{ width: "100%" }}
        >
          Upgrade
        </Button>
      )}
    </Card>
  );
};

function AIVisualEditorCallout(): React.ReactElement | null {
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
            label="Early access"
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
              AI Visual Editor
            </Heading>
            <Text
              as="div"
              size="1"
              style={{ color: "var(--gray-11)", whiteSpace: "nowrap" }}
            >
              Get early access June 22
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

function SidebarHeading({ children }: { children: string }) {
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
              Vercel Integration Docs
            </LinkItem>
            <LinkItem href="https://github.com/growthbook/growthbook/releases/tag/v4.4.0">
              4.4 Release Notes
            </LinkItem>
            <LinkItem href="https://docs.growthbook.io/">Docs</LinkItem>
            <LinkItem href="https://www.growthbook.io/pricing">
              Premium Features
            </LinkItem>
          </>
        );
      }

      return (
        <>
          <LinkItem href="https://docs.growthbook.io/">Docs</LinkItem>
          <LinkItem href="https://github.com/growthbook/growthbook/releases/tag/v4.4.0">
            4.4 Release Notes
          </LinkItem>
          <LinkItem href="https://www.growthbook.io/pricing">
            Premium Features
          </LinkItem>
        </>
      );

    case "features":
      return (
        <>
          <LinkItem href="https://docs.growthbook.io/lib/">
            GrowthBook SDK
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/features/basics">
            Feature Flag Basics
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/features/targeting">
            Targeting Attributes
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/warehouses">
            Connect Your Data Source
          </LinkItem>
        </>
      );

    case "experiments":
      return (
        <>
          <LinkItem href="https://docs.growthbook.io/experiments">
            Running Experiments
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/app/sticky-bucketing">
            Sticky Bucketing
            <PaidFeatureBadge commercialFeature="sticky-bucketing" mx="2" />
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/app/visual">
            Visual Editor
            <PaidFeatureBadge commercialFeature="visual-editor" mx="2" />
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/app/url-redirects">
            URL Redirects
            <PaidFeatureBadge commercialFeature="redirects" mx="2" />
          </LinkItem>
        </>
      );

    case "imports":
      return (
        <>
          <LinkItem href="https://docs.growthbook.io/warehouses">
            Connect to Your Data Warehouse
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/app/fact-tables">
            Fact Tables
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/app/data-pipeline">
            Data Pipeline Mode
            <PaidFeatureBadge commercialFeature="pipeline-mode" mx="2" />
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/app/experiment-results">
            Experiment Results
          </LinkItem>
        </>
      );
  }
}

export default DocumentationSidebar;
