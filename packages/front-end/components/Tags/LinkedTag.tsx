import { Box } from "@radix-ui/themes";
import { MouseEvent } from "react";
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
      onClick={(e) => {
        e.stopPropagation();
        // Let modifier/middle clicks fall through to the anchor so they open in a new tab.
        if (
          !onTagClick ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey ||
          e.button !== 0
        ) {
          return;
        }
        onTagClick(tag, e);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        overflow: "hidden",
        color: "inherit",
      }}
    >
      {tag}
    </Link>
  );

  const tooltipContent = entity ? (
    <>
      <Box>
        View other {entity} with the <strong>{tag}</strong> tag
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
