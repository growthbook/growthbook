import { PiSealQuestion } from "react-icons/pi";
import { Card, Flex, Heading, Separator, Text } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import Button from "@/components/Radix/Button";
import Link from "@/components/Radix/Link";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PaidFeatureBadge from "./PaidFeatureBadge";

interface Props {
  setUpgradeModal: (open: boolean) => void;
  type: "get-started" | "features" | "experiments" | "imports";
}

const DocumentationSidebar = ({
  setUpgradeModal,
  type,
}: Props): React.ReactElement => {
  const { accountPlan } = useUser();

  const permissionsUtil = usePermissionsUtil();

  const canUpgrade =
    accountPlan !== "enterprise" && permissionsUtil.canManageBilling();

  return (
    <Card style={{ padding: "var(--space-5)" }}>
      <SidebarHeading>FEATURED DOCS</SidebarHeading>
      <Flex direction="column" gapY="3">
        {getLinksFor(type)}
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
            GrowthBook Slack
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

function SidebarHeading({ children }: { children: string }) {
  return (
    <Heading as="h6" size="1" mb="2">
      {children}
    </Heading>
  );
}

function LinkItem(
  props: React.ComponentProps<typeof Link>
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

function getLinksFor(type: Props["type"]): JSX.Element {
  switch (type) {
    case "get-started":
      return (
        <>
          <LinkItem href="https://docs.growthbook.io/quick-start">
            QuickStart Guide
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/overview">
            How it Works
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/lib/">SDK Docs</LinkItem>
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
            <PaidFeatureBadge type="pro" />
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/app/visual">
            Visual Editor
            <PaidFeatureBadge type="pro" />
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/app/url-redirects">
            URL Redirects
            <PaidFeatureBadge type="pro" />
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
            <PaidFeatureBadge type="enterprise" />
          </LinkItem>
          <LinkItem href="https://docs.growthbook.io/app/experiment-results">
            Experiment Results
          </LinkItem>
        </>
      );
  }
}

export default DocumentationSidebar;
