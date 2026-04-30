import Text from "@/ui/Text";

export function revisionLabelText(
  version: number,
  title?: string | null,
  numbered?: boolean,
): string {
  return `${numbered ? `${version}. ` : ""}${title ?? `Revision ${version}`}`;
}

export default function RevisionLabel({
  version,
  title,
  numbered = true,
  minWidth = "1.9em",
}: {
  version: number;
  title?: string | null;
  numbered?: boolean;
  minWidth?: string | number;
}) {
  return (
    <>
      {numbered && (
        <span
          style={{
            display: "inline-block",
            minWidth,
            paddingRight: ".4em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <Text as="span" color="text-mid" size="small">
            {version}.
          </Text>
        </span>
      )}
      {title ? title : `Revision ${version}`}
    </>
  );
}
