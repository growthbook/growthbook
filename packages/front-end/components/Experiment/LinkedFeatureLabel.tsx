import { Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import Avatar from "@/ui/Avatar";
import Link from "@/ui/Link";
import { ICON_PROPERTIES } from "@/components/Experiment/LinkedChanges/constants";

const { component: FlagIcon, radixColor: FLAG_COLOR } =
  ICON_PROPERTIES["feature-flag"];

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
      <Avatar radius="small" color={FLAG_COLOR} size="sm" variant="soft">
        <FlagIcon />
      </Avatar>
      <Link
        href={`/features/${featureId}`}
        target="_blank"
        rel="noreferrer"
        size="md"
        weight="medium"
      >
        {featureId}
        <PiArrowSquareOut style={{ marginLeft: "var(--space-2)" }} />
      </Link>
    </Flex>
  );
}
