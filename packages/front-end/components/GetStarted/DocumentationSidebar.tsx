import { PiSealQuestion } from "react-icons/pi";
import { date as formatDate } from "shared/dates";
import { Card, Flex, Separator } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PaidFeatureBadge from "./PaidFeatureBadge";

interface BlogPost {
  url: string;
  title: string;
  excerpt: string;
  published_at: string;
  tag: string | null;
  reading_time: number;
}

interface BlogRecentResponse {
  status: 200;
  articles: BlogPost[];
  latestRelease: BlogPost | null;
}

interface Props {
  setUpgradeModal: (open: boolean) => void;
  type: "get-started" | "features" | "experiments" | "imports" | "data-source";
}

const DocumentationSidebar = ({
  setUpgradeModal,
  type,
}: Props): React.ReactElement => {
  const { accountPlan, organization } = useUser();
  const { data: blogData } = useApi<BlogRecentResponse>("/blog/recent", {
    autoRevalidate: false,
  });

  const permissionsUtil = usePermissionsUtil();
  const canUpgrade =
    accountPlan !== "enterprise" &&
    permissionsUtil.canManageBilling() &&
    !organization.isVercelIntegration;

  return (
    <>
      <Card style={{ padding: "var(--space-5)" }}>
        <SidebarHeading>FEATURED DOCS</SidebarHeading>
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
            <Text ml="1">Community</Text>
          </LinkItem>

          <LinkItem href="https://docs.growthbook.io/faq">
            <PiSealQuestion style={{ width: "20px", height: "20px" }} />
            <Text ml="1">GrowthBook FAQs</Text>
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
      {blogData && (
        <Card style={{ padding: "var(--space-5)" }} mt="4">
          <SidebarHeading>WHAT&apos;S NEW</SidebarHeading>
          {blogData.latestRelease && (
            <>
              <SubHeading>Latest Release</SubHeading>
              <BlogPostItem post={blogData.latestRelease} />
            </>
          )}
          {blogData.articles.length > 0 && (
            <>
              {blogData.latestRelease && <Separator size="4" my="4" />}
              <SubHeading>Featured Posts</SubHeading>
              <Flex direction="column" gapY="3">
                {blogData.articles.map((post) => (
                  <BlogPostItem key={post.url} post={post} />
                ))}
              </Flex>
            </>
          )}
        </Card>
      )}
    </>
  );
};

function SidebarHeading({ children }: { children: string }) {
  return (
    <Heading as="h6" mb="2" size="small">
      {children}
    </Heading>
  );
}

function SubHeading({ children }: { children: string }) {
  return (
    <Text weight="medium" color="text-mid" mb="1" as="p">
      {children}
    </Text>
  );
}

function BlogPostItem({ post }: { post: BlogPost }) {
  return (
    <LinkItem href={post.url}>
      <Flex direction="column" gapY="1">
        <Text weight="medium" color="text-high">
          {post.title}
        </Text>
        <Text color="text-low" size="small">
          {formatDate(post.published_at)} &middot; {post.reading_time} min read
        </Text>
      </Flex>
    </LinkItem>
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
