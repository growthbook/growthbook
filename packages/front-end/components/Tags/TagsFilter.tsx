import { useLocalStorage } from "../../hooks/useLocalStorage";
import Dropdown from "../Dropdown/Dropdown";
import DropdownLink from "../Dropdown/DropdownLink";
import Tag from "./Tag";

const MAX_TAGS = 12;

interface ItemWithTags {
  tags?: string[];
}

interface TagsFilter {
  tags: string[];
  setTags: (tags: string[]) => void;
}

export interface Props {
  filter: TagsFilter;
  items: ItemWithTags[];
}

export function filterByTags<T extends ItemWithTags>(
  items: T[],
  { tags }: TagsFilter
): T[] {
  if (!tags.length) return items;

  return items.filter((item) => {
    if (!item.tags) return false;
    for (let i = 0; i < tags.length; i++) {
      if (!item.tags.includes(tags[i])) return false;
    }
    return true;
  });
}

export function useTagsFilter(page: string): TagsFilter {
  const [tags, setTags] = useLocalStorage<string[]>(page + ":tags-filter", []);
  return {
    tags,
    setTags,
  };
}

export default function TagsFilter({
  filter: { tags, setTags },
  items,
}: Props) {
  const counts: Record<string, number> = {};
  const availableTags: string[] = [];
  items.forEach((item) => {
    if (item.tags) {
      item.tags.forEach((tag) => {
        counts[tag] = counts[tag] || 0;
        counts[tag]++;

        if (!availableTags.includes(tag) && !tags.includes(tag)) {
          availableTags.push(tag);
        }
      });
    }
  });
  availableTags.sort((a, b) => {
    return (counts[b] || 0) - (counts[a] || 0);
  });

  if (!tags.length && !availableTags.length) {
    return null;
  }

  const numToShow = Math.max(0, MAX_TAGS - tags.length);

  return (
    <div className="d-inline-flex">
      <div>Filter by tags:</div>
      <div>
        {tags.map((tag) => (
          <Tag
            tag={tag}
            key={tag}
            onClick={async () => {
              setTags(tags.filter((t) => t !== tag));
            }}
            description="Remove tag filter"
            className="mx-1"
          >
            <strong className="ml-1">&times;</strong>
          </Tag>
        ))}
        {availableTags.slice(0, numToShow).map((tag) => {
          return (
            <Tag
              tag={tag}
              key={tag}
              onClick={async () => {
                setTags([...tags, tag]);
              }}
              description="Add tag filter"
              className="mx-1 text-dark"
              color="#fff"
            />
          );
        })}
      </div>
      {availableTags.length > numToShow && (
        <div className="ml-2">
          <Dropdown uuid="tags-filter-more-menu" toggle={"more"}>
            {availableTags.slice(numToShow).map((tag) => {
              return (
                <DropdownLink
                  onClick={async () => {
                    setTags([...tags, tag]);
                  }}
                  key={tag}
                >
                  {tag}
                </DropdownLink>
              );
            })}
          </Dropdown>
        </div>
      )}
    </div>
  );
}
