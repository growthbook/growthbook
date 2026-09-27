import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import track from "@/services/track";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

/**
 * Offers to link an assignment attribute that no identifier type claims, so
 * experiments using it get an assignment query picked for them. Dismissed per
 * experiment.
 */
export default function LinkHashAttributeCallout({
  experimentId,
  datasource,
  hashAttribute,
  source,
}: {
  experimentId: string;
  datasource: DataSourceInterfaceWithParams | null;
  hashAttribute: string;
  source: string;
}) {
  const permissionsUtil = usePermissionsUtil();
  if (
    !datasource ||
    datasource.type === "growthbook_clickhouse" ||
    !permissionsUtil.canUpdateDataSourceSettings(datasource) ||
    !datasource.settings?.queries?.exposure?.length ||
    (datasource.settings?.userIdTypes || []).some((t) =>
      t.attributes?.includes(hashAttribute),
    )
  ) {
    return null;
  }

  return (
    <Callout
      status="info"
      mb="3"
      dismissible
      id={`link-hash-attribute-${experimentId}`}
    >
      Link the <strong>{hashAttribute}</strong> attribute to an identifier type
      in{" "}
      <Link
        href={`/datasources/${datasource.id}`}
        target="_blank"
        rel="noreferrer"
        onClick={() =>
          track("Link Hash Attribute to Identifier Type", {
            source,
            datasource: datasource.id,
            hashAttribute,
          })
        }
      >
        {datasource.name}
      </Link>{" "}
      to automatically select an assignment query when creating an experiment.
    </Callout>
  );
}
