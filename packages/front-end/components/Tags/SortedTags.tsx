import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "../Tooltip/Tooltip";
import Tag from "./Tag";

export interface Props {
  tags?: string[];
  shouldShowEllipsis?: boolean;
}

export default function SortedTags({ tags, shouldShowEllipsis }: Props) {
  const { tags: all } = useDefinitions();
  //index starting at 0
  const SHOW_ELLIPSIS_AT_INDEX = 6;
  if (!tags || !tags.length) return null;

  const sortedIds = all.map((t) => t.id);

  const sorted = [...tags];
  sorted.sort((a, b) => {
    return sortedIds.indexOf(a) - sortedIds.indexOf(b);
  });

  const renderEllipsis = () => {
    const tags = sorted.slice(SHOW_ELLIPSIS_AT_INDEX);
    const tagCopy = `${tags.length} more tags...`;

    return (
      <Tooltip body={<>{renderTags(tags)}</>} usePortal={true}>
        <Tag
          tag={tagCopy}
          key="tag-ellipsis"
          skipMargin={true}
          color="#ffffff"
        />
      </Tooltip>
    );
  };

  const renderTags = (tags: string[]) => {
    return tags.map((tag) => <Tag tag={tag} key={tag} skipMargin={true} />);
  };

  const renderTruncatedTags = () => {
    //only whant to show ellipsis if the length is >  SHOW_ELLIPSIS_AT_INDEX;
    const truncatedTags = shouldShowEllipsis
      ? sorted.slice(0, SHOW_ELLIPSIS_AT_INDEX - 1)
      : sorted;
    const shouldRenderEllipsis =
      shouldShowEllipsis && truncatedTags.length < sorted.length;
    return (
      <div className="tags-container">
        {renderTags(truncatedTags)} {shouldRenderEllipsis && renderEllipsis()}{" "}
      </div>
    );
  };

  return <>{renderTruncatedTags()}</>;
}
