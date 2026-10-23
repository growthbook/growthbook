import { Flex } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";

export default function UsageMeter({
  used,
  limit,
  noun,
}: {
  used: number;
  limit: number;
  noun: string;
}) {
  // Exact counts and a floored share, so the line can't read "1M of 1M, 100%"
  // while events remain; red only once usage is really at the cap
  const atCap = limit > 0 && used >= limit;
  const pct = limit > 0 ? Math.floor((used / limit) * 100) : 0;
  const color = atCap ? "red" : pct >= 80 ? "amber" : null;
  const shownPct = atCap ? Math.round((used / limit) * 100) : pct;
  return (
    <Flex align="center" gap="2" mb="3">
      <Text size="sm" color="text-mid">
        {used.toLocaleString("en-US")} of {limit.toLocaleString("en-US")} {noun}{" "}
        this month
      </Text>
      {color ? (
        <Badge label={`${shownPct}%`} color={color} variant="soft" />
      ) : null}
    </Flex>
  );
}
