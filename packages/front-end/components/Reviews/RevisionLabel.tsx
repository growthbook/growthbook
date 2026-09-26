import { ComponentProps } from "react";
import { Size } from "@/ui/sizes";
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
  numberSize = "sm",
  numberColor = "text-mid",
}: {
  version: number;
  title?: string | null;
  numbered?: boolean;
  minWidth?: string | number;
  numberSize?: Size<"sm" | "md" | "lg" | "xl"> | "inherit";
  // "inherit" follows the surrounding text, e.g. on a dark tooltip.
  numberColor?: ComponentProps<typeof Text>["color"] | "inherit";
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
          {numberColor === "inherit" ? (
            <Text as="span" size={numberSize}>
              {version}.
            </Text>
          ) : (
            <Text as="span" color={numberColor} size={numberSize}>
              {version}.
            </Text>
          )}
        </span>
      )}
      {title ? title : `Revision ${version}`}
    </>
  );
}
