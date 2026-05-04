import { FC } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretRightFill } from "react-icons/pi";
import Collapsible from "react-collapsible";
import { DashboardInterface } from "shared/enterprise";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";

interface DashboardReferencesListProps {
  dashboards: DashboardInterface[];
}

const DashboardReferencesList: FC<DashboardReferencesListProps> = ({
  dashboards = [],
}) => {
  if (dashboards.length === 0) return null;

  return (
    <Box>
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
                Dashboards
              </Heading>
              <Badge radius="full" label={dashboards.length.toString()} />
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
            }}
          >
            {dashboards.map((dashboard) => (
              <li key={dashboard.id}>
                <Link
                  href={
                    dashboard.experimentId
                      ? `/experiment/${dashboard.experimentId}#dashboards/${dashboard.id}`
                      : `/product-analytics/dashboards/${dashboard.id}`
                  }
                  target="_blank"
                >
                  {dashboard.title}
                </Link>
              </li>
            ))}
          </ul>
        </Collapsible>
      </Flex>
    </Box>
  );
};

export default DashboardReferencesList;
