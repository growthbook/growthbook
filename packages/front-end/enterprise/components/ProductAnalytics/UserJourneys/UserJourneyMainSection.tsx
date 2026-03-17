import { Flex } from "@radix-ui/themes";
import { PiTreeStructure } from "react-icons/pi";
import Text from "@/ui/Text";
import { useUserJourneyContext } from "./UserJourneyContext";
import Toolbar from "./Toolbar";
import UserJourneySankeyChart from "./UserJourneySankeyChart";

export default function UserJourneyMainSection() {
  const { userJourney } = useUserJourneyContext();
  return (
    <Flex
      direction="column"
      px="2"
      py="3"
      gap="4"
      id="main-section-wrapper"
      style={{ flex: "1", minHeight: 0 }}
    >
      <Toolbar />
      <Flex
        direction="column"
        gap="3"
        style={{ flex: "1", minHeight: 0, position: "relative" }}
        id="main-section-visuals"
      >
        {userJourney?.result?.rows?.length &&
        userJourney?.result?.rows?.length > 0 ? (
          <UserJourneySankeyChart rows={userJourney.result.rows} />
        ) : (
          <Flex
            align="center"
            justify="center"
            direction="column"
            gap="3"
            style={{
              flex: 1,
              minHeight: "400px",
              color: "var(--color-text-mid)",
              border: "2px dashed var(--gray-a3)",
              borderRadius: "var(--radius-4)",
            }}
          >
            <PiTreeStructure size={48} className="text-muted" />
            <Text size="large" weight="medium">
              Select an event to see what your users do before and after it.
            </Text>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}
