import Text from "@/ui/Text";

export function revisionLabelText(
  version: number,
  title: string,
  numbered?: boolean,
): string {
  return `${numbered ? `${version}. ` : ""}${title}`;
}

export default function RevisionLabel({
  version,
  title,
  numbered = true,
}: {
  version: number;
  title: string;
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
