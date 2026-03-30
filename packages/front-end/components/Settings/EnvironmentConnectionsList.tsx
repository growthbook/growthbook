import { FC } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretRightFill } from "react-icons/pi";
import Collapsible from "react-collapsible";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";

interface EnvironmentConnectionsListProps {
  connections: SDKConnectionInterface[];
}

const EnvironmentConnectionsList: FC<EnvironmentConnectionsListProps> = ({
  connections = [],
}) => {
  if (connections.length === 0) return null;

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
                SDK Connections
              </Heading>
              <Badge radius="full" label={connections.length.toString()} />
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
            {connections.map((c) => (
              <li key={c.id}>
                <Link href={`/sdks/${c.id}`} target="_blank">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </Collapsible>
      </Flex>
    </Box>
  );
};

export default EnvironmentConnectionsList;
