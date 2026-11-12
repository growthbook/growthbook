import Button, { Props as ButtonProps } from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Tooltip from "@/ui/Tooltip";

export default function OpenInExplorerButton({
  href,
  tooltip,
  enabled,
  disabledReason = null,
}: {
  href: string;
  tooltip: string;
  enabled: boolean;
  disabledReason?: string | null;
}) {
  if (!enabled) return null;

  const buttonStyleProps: {
    variant: ButtonProps["variant"];
    size: ButtonProps["size"];
  } = {
    variant: "outline",
    size: "md",
  };

  if (disabledReason) {
    return (
      <Tooltip content={disabledReason}>
        {/* inline-flex: an inline span sits on the text baseline and drops the button a few px */}
        {/* tabIndex: lets keyboard users focus it and read the reason */}
        <span
          tabIndex={0}
          style={{ cursor: "not-allowed", display: "inline-flex" }}
        >
          <Button
            {...buttonStyleProps}
            disabled
            style={{ pointerEvents: "none" }}
          >
            Open in Explorer
          </Button>
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={tooltip}>
      <LinkButton href={href} {...buttonStyleProps} preventDefault={false}>
        Open in Explorer
      </LinkButton>
    </Tooltip>
  );
}
