import Callout from "@/ui/Callout";

export default function ArchiveStateCallout({
  noun,
  liveArchived,
  viewedArchived,
}: {
  noun: string;
  liveArchived: boolean;
  viewedArchived: boolean;
}) {
  if (liveArchived && !viewedArchived) {
    return (
      <Callout status="info" mt="3">
        <strong>This draft will unarchive the {noun}.</strong> Once published,
        it becomes active again.
      </Callout>
    );
  }
  if (liveArchived) {
    return (
      <Callout status="info" mt="3">
        <strong>This {noun} is archived.</strong> It stays inactive until
        it&apos;s unarchived.
      </Callout>
    );
  }
  if (viewedArchived) {
    return (
      <Callout status="warning" mt="3">
        <strong>This draft will archive the {noun}.</strong> Once published, it
        becomes inactive.
      </Callout>
    );
  }
  return null;
}
