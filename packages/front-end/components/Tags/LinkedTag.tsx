import { Box } from "@radix-ui/themes";
import { MouseEvent } from "react";
import { Trans } from "@lingui/react/macro";
import { useDefinitions } from "@/services/DefinitionsContext";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";
import Tag, { TagProps } from "./Tag";

type Props = Omit<TagProps, "label"> & {
  href: string;
  entity?: string;
  onTagClick?: (tag: string, e: MouseEvent) => void;
};

export default function LinkedTag({
  tag,
  href,
  entity,
  onTagClick,
  ...tagProps
}: Props) {
  const { getTagById } = useDefinitions();
  const description =
    tagProps.description ?? getTagById(tag)?.description ?? "";

  const link = (
    <Link
      href={href}
      target={onTagClick ? undefined : "_blank"}
      className="hover-underline"
      onClick={onTagClick ? (e) => onTagClick(tag, e) : undefined}
      // The pill sets the type; the link inside it should not stretch the row.
      style={{ color: "inherit", fontSize: "inherit", lineHeight: "inherit" }}
    >
      {tag}
    </Link>
  );

  const tooltipContent = entity ? (
    <>
      <Box>
        <ViewOtherWithTag entity={entity} tag={tag} />
      </Box>
      {description && <Box mt="2">{description}</Box>}
    </>
  ) : null;

  const label = tooltipContent ? (
    <Tooltip content={tooltipContent}>{link}</Tooltip>
  ) : (
    link
  );

  return <Tag {...tagProps} tag={tag} label={label} />;
}

// One whole sentence per entity, so each reads naturally once translated.
function ViewOtherWithTag({ entity, tag }: { entity: string; tag: string }) {
  switch (entity) {
    case "features":
      return (
        <Trans>
          View other features with the <strong>{tag}</strong> tag
        </Trans>
      );
    case "experiments":
      return (
        <Trans>
          View other experiments with the <strong>{tag}</strong> tag
        </Trans>
      );
    case "metrics":
      return (
        <Trans>
          View other metrics with the <strong>{tag}</strong> tag
        </Trans>
      );
    case "bandits":
      return (
        <Trans>
          View other bandits with the <strong>{tag}</strong> tag
        </Trans>
      );
    case "contextual-bandits":
      return (
        <Trans>
          View other contextual-bandits with the <strong>{tag}</strong> tag
        </Trans>
      );
    default:
      return (
        <Trans>
          View other {entity} with the <strong>{tag}</strong> tag
        </Trans>
      );
  }
}
