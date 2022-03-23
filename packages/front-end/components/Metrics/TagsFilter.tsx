import { useState } from "react";
import Dropdown from "../Dropdown/Dropdown";
import DropdownLink from "../Dropdown/DropdownLink";

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

const MAX_TAGS = 5;

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

export function useTagsFilter(): TagsFilter {
  const [tags, setTags] = useState<string[]>([]);
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
          <a
            key={tag}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setTags(tags.filter((t) => t !== tag));
            }}
            className="badge mx-1 badge-primary"
            title="Remove tag filter"
          >
            {tag} <strong className="ml-1">&times;</strong>
          </a>
        ))}
        {availableTags.slice(0, numToShow).map((tag) => {
          return (
            <a
              key={tag}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setTags([...tags, tag]);
              }}
              className="badge mx-1 badge-light border"
              title="Add tag filter"
            >
              {tag}
            </a>
          );
        })}
      </div>
      {availableTags.length > numToShow && (
        <div className="ml-2">
          <Dropdown uuid="tags-filter-more-menu" toggle={"more"}>
            {availableTags.slice(numToShow).map((tag) => {
              return (
                <DropdownLink
                  key={tag}
                  onClick={() => {
                    setTags([...tags, tag]);
                  }}
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
