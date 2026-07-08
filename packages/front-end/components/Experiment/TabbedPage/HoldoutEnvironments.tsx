import { FeatureEnvironment } from "shared/types/feature";
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
        <Heading color="text-high" as="h4" size="small" mb="0">
          Included Environments
        </Heading>
        <div className="flex-1" />
        <Link onClick={editEnvironments}>
          <Text weight="semibold">Edit</Text>
        </Link>
      </div>
      <div>
        {Object.keys(environments)
          .filter((e) => environments[e].enabled)
          .join(", ")}
      </div>
    </Frame>
  );
}
