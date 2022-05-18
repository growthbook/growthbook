import { useLocalStorage } from "../../hooks/useLocalStorage";
import Dropdown from "../Dropdown/Dropdown";
import DropdownLink from "../Dropdown/DropdownLink";
import Tag from "./Tag";
import { useDefinitions } from "../../services/DefinitionsContext";
import { useState } from "react";
import Field from "../Forms/Field";

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
  const { getTagById } = useDefinitions();
  const [typeaheadFilter, setTypeaheadFilter] = useState("");
  //const showUntaggedOption = !tags.length; //<-- it would be good to filter untagged eventually
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
  const filteredTags = availableTags.filter((t) => {
    if (!typeaheadFilter) return true;
    return t.toLowerCase().startsWith(typeaheadFilter.toLowerCase());
  });

  if (!tags.length && !availableTags.length) {
    return null;
  }

  return (
    <div className="d-inline-flex align-items-center">
      {availableTags.length && (
        <div className="">
          <Dropdown
            uuid="tags-filter-more-menu"
            toggle={"filter by tag"}
            right={false}
          >
            <div style={{ maxWidth: 350, minWidth: 280 }}>
              <div className="dropdown-item-text border-bottom pb-3">
                <Field
                  value={typeaheadFilter}
                  placeholder="Filter tags"
                  onChange={(e) => {
                    setTypeaheadFilter(e.target.value);
                  }}
                />
              </div>
              {filteredTags.map((tag) => {
                const desc = getTagById(tag)?.description ?? "";
                return (
                  <DropdownLink
                    onClick={async () => {
                      setTags([...tags, tag]);
                    }}
                    key={tag}
                    className="border-bottom py-2"
                  >
                    <Tag tag={tag} />
                    {desc && (
                      <div
                        className="pt-1 text-muted"
                        style={{
                          whiteSpace: "normal",
                          fontSize: "12px",
                          lineHeight: "13px",
                        }}
                      >
                        <span>{getTagById(tag)?.description}</span>
                      </div>
                    )}
                  </DropdownLink>
                );
              })}
            </div>
          </Dropdown>
        </div>
      )}
      <div className="ml-2 pt-1">
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
      </div>
    </div>
  );
}
