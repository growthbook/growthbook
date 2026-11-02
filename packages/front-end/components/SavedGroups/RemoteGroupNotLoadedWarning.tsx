import { SavedGroupUploadDetails } from "shared/validators";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";

/**
 * For "not in group" checks: warns when a remote group's live version hasn't
 * been loaded by any data store, since lookups then can't tell the group is
 * missing and the check can match everyone.
 */
export default function RemoteGroupNotLoadedWarning({
  groupId,
}: {
  groupId: string;
}) {
  const { getSavedGroupById } = useDefinitions();
  const group = getSavedGroupById(groupId);
  const version =
    group?.type === "remote" ? group.currentUploadVersion : undefined;
  const { data } = useApi<SavedGroupUploadDetails>(
    `/saved-groups/${groupId}/uploads/${version}`,
    { shouldRun: () => version !== undefined },
  );

  // Groups without uploads keep their IDs in the customer's own storage
  if (!group || version === undefined || !data) return null;
  const { loads } = data.upload;
  if (loads.some((l) => l.status.type === "loaded")) return null;
  // Failed and invalid loads won't finish on their own
  const failed = loads.some(
    (l) => l.status.type === "failed" || l.status.type === "invalid",
  );

  const name = (
    <Link href={`/saved-groups/${group.id}`} target="_blank">
      {group.groupName}
    </Link>
  );
  return (
    <HelperText status="warning" size="sm" mt="1">
      <span>
        {failed ? (
          <>Loading {name} failed in a data store.</>
        ) : (
          <>{name} hasn&apos;t been loaded by any data store yet.</>
        )}{" "}
        Until it is, &quot;not in group&quot; checks for it match everyone.
      </span>
    </HelperText>
  );
}
