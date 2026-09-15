import { Flex } from "@radix-ui/themes";
import Breadcrumbs from "./Breadcrumbs";

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
    </Flex>
  );
}
