import { FeatureEnvironment } from "shared/types/feature";
import { getEnabledHoldoutEnvironments } from "shared/util";
import { Trans } from "@lingui/react/macro";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";

export default function HoldoutEnvironments({
  environments,
  editEnvironments,
}: {
  environments: Record<string, FeatureEnvironment>;
  editEnvironments: () => void;
}) {
  return (
    <Frame>
      <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-2">
        <Heading color="text-high" as="h4" size="sm" mb="0">
          <Trans>Included Environments</Trans>
        </Heading>
        <div className="flex-1" />
        <Link onClick={editEnvironments}>
          <Text weight="semibold">
            <Trans>Edit</Trans>
          </Text>
        </Link>
      </div>
      <div>{getEnabledHoldoutEnvironments(environments).join(", ")}</div>
    </Frame>
  );
}
