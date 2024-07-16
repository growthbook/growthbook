import { SavedGroupInterface } from "shared/src/types";

export default function SavedGroupNameWithBadge({
  savedGroup,
}: {
  savedGroup: SavedGroupInterface;
}) {
  return (
    <>
      {savedGroup.groupName}
      {savedGroup.passByReferenceOnly ? (
        <span className="ml-1 badge-darkgray badge rounder float-right fw-bold">
          Large
        </span>
      ) : (
        <></>
      )}
    </>
  );
}
