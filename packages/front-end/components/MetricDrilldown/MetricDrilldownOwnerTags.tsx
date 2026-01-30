import { Flex, Text } from "@radix-ui/themes";
import Metadata from "@/ui/Metadata";
import metaDataStyles from "@/ui/Metadata.module.scss";
import SortedTags from "@/components/Tags/SortedTags";
import UserAvatar from "@/components/Avatar/UserAvatar";
import { ExperimentTableRow } from "@/services/experiments";

export function MetricDrilldownOwnerTags({ row }: { row: ExperimentTableRow }) {
  const { metric } = row;

  return (
    <Flex gap="4">
      <Metadata
        label="Owner"
        value={
          <Flex align="center" gap="1">
            {metric.owner && (
              <UserAvatar name={metric.owner} size="sm" variant="soft" />
            )}
            <Text weight="regular" className={metaDataStyles.valueColor}>
              {metric.owner || "None"}
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
