import { Flex } from "@radix-ui/themes";
import { PiFlag } from "react-icons/pi";
import Link from "@/ui/Link";

/**
 * Names the Feature Flag an editor is writing to, drawn like a linked flag's
 * row. Only worth showing when the experiment doesn't own the flag — a managed
 * flag is implied by the surface.
 */
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
