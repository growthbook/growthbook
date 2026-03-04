import { Flex, Text } from "@radix-ui/themes";
import Metadata from "@/ui/Metadata";
import metaDataStyles from "@/ui/Metadata.module.scss";
import SortedTags from "@/components/Tags/SortedTags";
import UserAvatar from "@/components/Avatar/UserAvatar";
import { ExperimentTableRow } from "@/services/experiments";
import { useUser } from "@/services/UserContext";

export function MetricDrilldownOwnerTags({ row }: { row: ExperimentTableRow }) {
  const { metric } = row;
  const { getOwnerDisplay } = useUser();
  const ownerDisplay = getOwnerDisplay(metric.owner || "");

  return (
    <Flex gap="4">
      <Metadata
        label="Owner"
        value={
          <Flex align="center" gap="1">
            {ownerDisplay && (
              <UserAvatar name={ownerDisplay} size="sm" variant="soft" />
            )}
            <Text weight="regular" className={metaDataStyles.valueColor}>
              {ownerDisplay || "None"}
            </Text>
          </Flex>
        }
      />

      {(metric.tags?.length ?? 0) > 0 ? (
        <Metadata
          label="Tags"
          value={
            <SortedTags
              tags={metric.tags}
              shouldShowEllipsis={false}
              useFlex={true}
            />
          }
        />
      ) : null}
    </Flex>
  );
}
