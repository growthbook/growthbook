import { Text } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import Tag from "./Tag";

export interface Props {
  tags?: string[];
  shouldShowEllipsis?: boolean;
  skipFirstMargin?: boolean;
  useFlex?: boolean;
  showEllipsisAtIndex?: number;
}

export default function SortedTags({
  tags,
  shouldShowEllipsis = true,
  skipFirstMargin = false,
  useFlex = false,
  showEllipsisAtIndex = 5,
}: Props) {
  const { tags: all } = useDefinitions();
  //index starting at 0
  if (!tags || !tags.length) return null;

  const sortedIds = all.map((t) => t.id);

  const sorted = [...tags];
  sorted.sort((a, b) => {
    return sortedIds.indexOf(a) - sortedIds.indexOf(b);
  });

  const renderEllipsis = () => {
    const tags = sorted.slice(showEllipsisAtIndex);
    const moreTagsCopy = `+${tags.length}`;
    const tagElements = renderTags(tags);
    return (
      <Tooltip
        body={<>{renderFlexContainer(tagElements, true)}</>}
        usePortal={true}
      >
        <Text ml={useFlex ? undefined : "2"}>{moreTagsCopy}</Text>
      </Tooltip>
    );
  };

  const renderTags = (tags: string[]) => {
    return tags.map((tag, i) => {
      const skipMargin = useFlex || (skipFirstMargin && i === 0);
      return <Tag tag={tag} key={tag} skipMargin={skipMargin} />;
    });
  };
  const renderFlexContainer = (
    child: JSX.Element | JSX.Element[],
    shouldUseFlex = useFlex,
  ) => {
    return shouldUseFlex ? (
      <div className="tags-container">{child}</div>
    ) : (
      child
    );
  };

  const renderTruncatedTags = () => {
    let truncatedTags = sorted;
    if (shouldShowEllipsis && sorted.length > showEllipsisAtIndex + 1) {
      truncatedTags = sorted.slice(0, showEllipsisAtIndex);
    }

    const shouldRenderEllipsis =
      shouldShowEllipsis && truncatedTags.length < sorted.length;
    return renderFlexContainer(
      <>
        {renderTags(truncatedTags)}
        {shouldRenderEllipsis && renderEllipsis()}
      </>,
    );
  };

  return <>{renderTruncatedTags()}</>;
}
