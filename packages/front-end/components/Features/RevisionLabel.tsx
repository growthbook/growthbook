import Text from "@/ui/Text";

export function revisionLabelText(
  version: number,
  title: string | null | undefined,
  numbered?: boolean,
): string {
  // Fall back to "Revision <n>" when there's no title — e.g. for the HTML
  // `title` tooltip on truncated revision labels, which would otherwise be
  // empty for untitled revisions.
  const labelTitle = title ?? `Revision ${version}`;
  return `${numbered ? `${version}. ` : ""}${labelTitle}`;
}

export default function RevisionLabel({
  version,
  title,
  numbered = true,
}: {
  version: number;
  title: string | null | undefined;
  numbered?: boolean;
}) {
  return (
    <>
      {numbered && (
        <span
          style={{
            display: "inline-block",
            minWidth: "1.9em",
            paddingRight: ".4em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <Text as="span" color="text-mid" size="small">
            {version}.
          </Text>
        </span>
      )}
      {title}
    </>
  );
}
