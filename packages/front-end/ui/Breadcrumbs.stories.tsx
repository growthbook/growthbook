import { Flex } from "@radix-ui/themes";
import { StoryMeta } from "@/ui/storyMeta";
import Breadcrumbs from "./Breadcrumbs";

export const meta: StoryMeta = {
  name: "Breadcrumbs",
  category: "navigation",
  status: "stable",
  summary:
    "A trail of links that shows where the current page sits in the hierarchy.",
  useWhen: ["Show the path back to parent pages on a detail page."],
  avoidWhen: [
    {
      reason: "You need to move between peer sections.",
      use: "Tabs",
    },
  ],
  related: ["Link"],
};

export default function BreadcrumbsStories() {
  return (
    <Flex direction="column" gap="3">
      <Breadcrumbs
        items={[
          { display: "Page 1", href: "/page-1" },
          { display: "Page 2", href: "/page-2" },
          { display: "Page 3" },
        ]}
      />
      <Breadcrumbs
        items={[
          { display: "Page 1", href: "/page-1" },
          { display: "Page 2", href: "/page-2" },
          { display: "Page 3", href: "/page-3" },
          { display: "Page 4", href: "/page-4" },
          { display: "Page 5", href: "/page-5" },
        ]}
      />
      <Breadcrumbs
        muted
        items={[
          { display: "Settings" },
          { display: "Organization" },
          { display: "Projects" },
        ]}
      />
    </Flex>
  );
}
