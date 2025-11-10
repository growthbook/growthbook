import { useContext } from "react";
import { Flex, Text, TextProps } from "@radix-ui/themes";
import { FaExclamationTriangle } from "react-icons/fa";
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
  const { allQueries, savedQueriesMap, snapshotError, refreshStatus } =
    useContext(DashboardSnapshotContext);
  const savedQueryIds = [...savedQueriesMap.keys()];
  const count = (allQueries ?? []).length + savedQueryIds.length;
  return (
    <ViewAsyncQueriesButton
      ctaComponent={(onClick) => (
        <Button
          disabled={count === 0}
          onClick={onClick}
          className={className}
          style={{
            color: refreshStatus === "failed" ? "red" : undefined,
          }}
          {...buttonProps}
        >
          <Flex align="center" justify="between">
            <Text weight={weight} size={size}>
              {refreshStatus === "failed"
                ? "View failed queries"
                : "View queries"}
            </Text>
            {refreshStatus === "failed" ? (
              <FaExclamationTriangle />
            ) : !hideQueryCount ? (
              <Badge
                ml="1"
                label={count.toString()}
                variant="soft"
                radius="full"
              />
            ) : null}
          </Flex>
        </Button>
      )}
      error={snapshotError}
      queries={allQueries.map((q) => q.query) ?? []}
      savedQueries={savedQueryIds}
      icon={null}
      status={refreshStatus}
      hideQueryCount
    />
  );
}
