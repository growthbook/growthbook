import { Flex } from "@radix-ui/themes";
import { FaRegFlag } from "react-icons/fa";
import { PiArrowSquareOut } from "react-icons/pi";
import Avatar from "@/ui/Avatar";
import Link from "@/ui/Link";

/**
 * Names the Feature Flag an editor is writing to. Only worth showing when the
 * experiment doesn't own the flag — a managed flag is implied by the surface.
 */
export default function LinkedFeatureLabel({
  featureId,
}: {
  featureId: string;
}) {
  return (
    <Flex align="center" gap="3">
      <Avatar radius="small" color="indigo" size="sm" variant="soft">
        <FaRegFlag />
      </Avatar>
      <Link
        href={`/features/${featureId}`}
        target="_blank"
        rel="noreferrer"
        size="md"
        weight="medium"
      >
        {featureId}
        <PiArrowSquareOut className="ml-2" />
      </Link>
    </Flex>
  );
}
