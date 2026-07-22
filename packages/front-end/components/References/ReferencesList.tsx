import { FC, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretRightFill } from "react-icons/pi";
import Collapsible from "react-collapsible";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import CounterBadge from "@/ui/Badge/CounterBadge";
import ProjectBadges from "@/components/ProjectBadges";
import Pagination from "@/ui/Pagination";

const PER_PAGE = 50;

export type ReferenceItem = {
  id: string;
  label: string;
  href: string;
  projectIds?: string[];
};

export type ReferenceSection = {
  title: string;
  resourceType: React.ComponentProps<typeof ProjectBadges>["resourceType"];
  items: ReferenceItem[];
};

// Renders one collapsible, paginated, project-badged list per non-empty section.
// Used by the saved-group and constant "references" modals.
const ReferencesListSection: FC<ReferenceSection> = ({
  title,
  resourceType,
  items,
}) => {
  const [page, setPage] = useState(1);
  const start = (page - 1) * PER_PAGE;
  const pageItems = items.slice(start, start + PER_PAGE);

  return (
    <Flex
      gap="2"
      p="3"
      mb="4"
      align="start"
      className="bg-highlight rounded"
      direction="column"
    >
      <Collapsible
        trigger={
          <Flex align="center" gap="1">
            <PiCaretRightFill className="chevron" />
            <Heading as="h3" size="small" mb="0">
              {title}
            </Heading>
            <CounterBadge color="neutral" count={items.length} />
          </Flex>
        }
        open={true}
        transitionTime={100}
      >
        <ul
          style={{
            margin: 0,
            paddingLeft: "var(--space-4)",
            marginTop: "var(--space-2)",
            listStyle: "none",
          }}
        >
          {pageItems.map((item) => (
            <li key={item.id}>
              <Flex justify="between" align="center" gap="2" my="1">
                <Link href={item.href} target="_blank">
                  {item.label}
                </Link>
                <ProjectBadges
                  resourceType={resourceType}
                  projectIds={item.projectIds}
                  skipMargin
                />
              </Flex>
            </li>
          ))}
        </ul>
        {items.length > PER_PAGE && (
          <Pagination
            numItemsTotal={items.length}
            perPage={PER_PAGE}
            currentPage={page}
            onPageChange={setPage}
            className="mt-2"
          />
        )}
      </Collapsible>
    </Flex>
  );
};

const ReferencesList: FC<{ sections: ReferenceSection[] }> = ({ sections }) => {
  return (
    <Box className="references-list">
      <style>{`.references-list .Collapsible { width: 100%; }`}</style>
      {sections
        .filter((s) => s.items.length > 0)
        .map((section) => (
          <ReferencesListSection key={section.title} {...section} />
        ))}
    </Box>
  );
};

export default ReferencesList;
