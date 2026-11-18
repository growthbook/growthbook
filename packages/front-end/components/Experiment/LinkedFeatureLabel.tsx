import { Flex } from "@radix-ui/themes";
import { PiFlag } from "react-icons/pi";
import Link from "@/ui/Link";

/** Names the Feature Flag an editor writes to, for flags the experiment doesn't manage. */
export default function LinkedFeatureLabel({
  featureId,
}: {
  featureId: string;
}) {
  return (
    <Flex align="center" gap="2" minWidth="0">
      <PiFlag style={{ color: "var(--color-text-low)" }} />
      <Link href={`/features/${featureId}`} external weight="medium">
        {featureId}
      </Link>
    </Flex>
  );
}
