import Callout from "@/ui/Callout";

// Under a details page's title: an archived entity, or a viewed draft that
// would archive it once published.
export default function ArchiveStateCallout({
  noun,
  liveArchived,
  viewedArchived,
}: {
  noun: string;
  liveArchived: boolean;
  viewedArchived: boolean;
}) {
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
