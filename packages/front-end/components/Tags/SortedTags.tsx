import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "../Tooltip/Tooltip";
import Tag from "./Tag";

export interface Props {
  tags?: string[];
  skipFirstMargin?: boolean;
  shouldShowEllipsis?: boolean;
}

export default function SortedTags({
  tags,
  skipFirstMargin,
  shouldShowEllipsis,
}: Props) {
  const { tags: all } = useDefinitions();
  //index starting at 0
  const SHOW_ELLIPSIS_AT_INDEX = 20;
  if (!tags || !tags.length) return null;

  const sortedIds = all.map((t) => t.id);

  const sorted = [...tags];
  sorted.sort((a, b) => {
    return sortedIds.indexOf(a) - sortedIds.indexOf(b);
  });

  const renderEllipsis = () => (
    <Tooltip body={<>{renderTags(sorted)}</>} usePortal={true}>
      <Tag tag="&hellip;" key="tag-ellipsis" />
    </Tooltip>
  );

  const renderTags = (tags: string[]) => {
    return tags.map((tag, i) => (
      <Tag tag={tag} key={tag} skipMargin={skipFirstMargin && i === 0} />
    ));
  };

  const renderTruncatedTags = () => {
    //only whant to show ellipsis if the length is >  SHOW_ELLIPSIS_AT_INDEX;
    const truncatedTags = shouldShowEllipsis
      ? sorted.slice(0, SHOW_ELLIPSIS_AT_INDEX - 1)
      : sorted;
    const shouldRenderEllipsis =
      shouldShowEllipsis && truncatedTags.length < sorted.length;
    return (
      <>
        {renderTags(truncatedTags)} {shouldRenderEllipsis && renderEllipsis()}{" "}
      </>
    );
  };

  return <>{renderTruncatedTags()}</>;
}
