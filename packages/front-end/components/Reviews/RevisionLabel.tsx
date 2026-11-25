import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Size } from "@/ui/sizes";
import Text from "@/ui/Text";

// Without `i18n` the fallback name is English, for callers not translated yet.
export function revisionLabelText(
  version: number,
  title?: string | null,
  numbered?: boolean,
  i18n?: I18n,
): string {
  const fallback = i18n
    ? i18n._(msg`Revision ${version}`)
    : `Revision ${version}`;
  return `${numbered ? `${version}. ` : ""}${title ?? fallback}`;
}

// Away from the flag's own revision list, where a bare number reads as a step.
export function NamedRevision({
  version,
  title,
}: {
  version: number;
  title?: string | null;
}) {
  return title ? (
    <Trans>
      Revision {version}: <em>{title}</em>
    </Trans>
  ) : (
    <Trans>Revision {version}</Trans>
  );
}

export default function RevisionLabel({
  version,
  title,
  numbered = true,
  minWidth = "1.9em",
  numberSize = "sm",
  inheritNumberColor = false,
}: {
  version: number;
  title?: string | null;
  numbered?: boolean;
  minWidth?: string | number;
  numberSize?: Size<"sm" | "md" | "lg" | "xl"> | "inherit";
  // Follow the surrounding text's colour, e.g. on a dark tooltip.
  inheritNumberColor?: boolean;
}) {
  const { t } = useLingui();
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
          <Text
            as="span"
            color={inheritNumberColor ? undefined : "text-mid"}
            size={numberSize}
          >
            {version}.
          </Text>
        </span>
      )}
      {title ? title : t`Revision ${version}`}
    </>
  );
}
