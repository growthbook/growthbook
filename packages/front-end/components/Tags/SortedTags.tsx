import { Text } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import Tag from "./Tag";

export type Props = {
  tags?: string[];
  shouldShowEllipsis?: boolean;
  skipFirstMargin?: boolean;
  useFlex?: boolean;
  showEllipsisAtIndex?: number;
  truncateTagChars?: number;
  /** When provided, used for the overflow label instead of "X more tag(s)...". Receives the count of hidden tags. */
  ellipsisFormat?: (count: number) => string;
  /**
   * Show at most this many tag pills, then "+N" (tooltip lists the rest).
   * When set, overrides showEllipsisAtIndex / shouldShowEllipsis for overflow.
   */
  maxVisibleTags?: number;
};

export default function SortedTags({
  tags,
  shouldShowEllipsis = true,
  skipFirstMargin = false,
  useFlex = false,
  showEllipsisAtIndex = 5,
  truncateTagChars,
  ellipsisFormat,
  maxVisibleTags,
}: Props) {
  const { tags: all } = useDefinitions();
  //index starting at 0
  if (!tags || !tags.length) return null;

  const sortedIds = all.map((t) => t.id);

  const sorted = [...tags];
  sorted.sort((a, b) => {
    return sortedIds.indexOf(a) - sortedIds.indexOf(b);
  });

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

  const renderTags = (tagsToRender: string[], truncateInTable = true) => {
    return tagsToRender.map((tag, i) => {
      const skipMargin = useFlex || (skipFirstMargin && i === 0);
      return (
        <Tag
          tag={tag}
          key={tag}
          skipMargin={skipMargin}
          maxChars={truncateInTable ? truncateTagChars : undefined}
        />
      );
    });
  };

  if (
    maxVisibleTags !== undefined &&
    maxVisibleTags >= 0 &&
    sorted.length > maxVisibleTags
  ) {
    const visible = sorted.slice(0, maxVisibleTags);
    const hidden = sorted.slice(maxVisibleTags);
    const n = hidden.length;
    const overflowLabel = ellipsisFormat ? ellipsisFormat(n) : `+${n}`;
    const hiddenTagElements = renderTags(hidden, false);
    return (
      <>
        {renderFlexContainer(
          <>
            {renderTags(visible)}
            <Tooltip
              flipTheme={false}
              body={<>{renderFlexContainer(hiddenTagElements, true)}</>}
              usePortal={true}
            >
              <Text ml={useFlex ? undefined : "2"} style={{ flexShrink: 0 }}>
                {overflowLabel}
              </Text>
            </Tooltip>
          </>,
        )}
      </>
    );
  }

  const renderEllipsis = () => {
    const overflowTags = sorted.slice(showEllipsisAtIndex);
    const moreTagsCopy = ellipsisFormat
      ? ellipsisFormat(overflowTags.length)
      : `${overflowTags.length} more tag${
          overflowTags.length === 1 ? "" : "s"
        }...`;
    const tagElements = renderTags(overflowTags, false);
    return (
      <Tooltip
        flipTheme={false}
        body={<>{renderFlexContainer(tagElements, true)}</>}
        usePortal={true}
      >
        <Text ml={useFlex ? undefined : "2"}>{moreTagsCopy}</Text>
      </Tooltip>
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
