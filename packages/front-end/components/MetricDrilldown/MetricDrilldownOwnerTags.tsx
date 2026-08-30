import { Flex } from "@radix-ui/themes";
import Metadata from "@/ui/Metadata";
import SortedTags from "@/components/Tags/SortedTags";
import Owner from "@/components/Avatar/Owner";
import { ExperimentTableRow } from "@/services/experiments";

export function MetricDrilldownOwnerTags({ row }: { row: ExperimentTableRow }) {
  const { metric } = row;

  return (
    <Flex gap="4">
      <Metadata
        label="Owner"
        value={<Owner ownerId={metric.owner} gap="1" textColor="text-mid" />}
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
