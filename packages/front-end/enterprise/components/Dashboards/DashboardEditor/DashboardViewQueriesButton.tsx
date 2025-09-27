import { useContext } from "react";
import { Flex, Text, TextProps } from "@radix-ui/themes";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Badge from "@/ui/Badge";
import Button, { Props as ButtonProps } from "@/ui/Button";
import { DashboardSnapshotContext } from "../DashboardSnapshotProvider";

interface Props {
  className?: string;
  size?: TextProps["size"];
  weight?: TextProps["weight"];
  buttonProps?: Partial<ButtonProps>;
  hideQueryCount?: boolean;
}

export default function DashboardViewQueriesButton({
  className,
  size = "2",
  weight = "bold",
  buttonProps = {},
  hideQueryCount = false,
}: Props) {
  const { allQueries } = useContext(DashboardSnapshotContext);
  const count = (allQueries ?? []).length;
  return (
    <ViewAsyncQueriesButton
      ctaComponent={(onClick) => (
        <Button onClick={onClick} className={className} {...buttonProps}>
          <Flex align="center" justify="between">
            <Text weight={weight} size={size}>
              View queries
            </Text>
            {!hideQueryCount && (
              <Badge
                ml="1"
                label={count.toString()}
                variant="soft"
                radius="full"
              />
            )}
          </Flex>
        </Button>
      )}
      queries={allQueries.map((q) => q.query) ?? []}
      icon={null}
      hideQueryCount
    />
  );
}
