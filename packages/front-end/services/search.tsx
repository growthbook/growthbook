import { useState, useMemo, ChangeEvent, FC } from "react";
import { FaSort, FaSortDown, FaSortUp } from "react-icons/fa";

export type IndexedObject<T> = {
  index: Record<string, string[]>;
  source: T;
};
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9.\-_: ]+/g, "")
    .replace(/[-_:.]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ");
}

const stopwords = /^(a|about|above|after|again|all|am|an|and|any|are|arent|as|at|be|because|been|before|below|between|both|but|by|can|cant|could|did|do|does|dont|down|during|each|few|for|from|had|has|have|having|here|how|if|in|into|is|isnt|it|its|itself|more|most|no|nor|not|of|on|once|only|or|other|our|out|over|own|same|should|shouldnt|so|some|such|that|than|then|the|there|theres|these|this|those|through|to|too|under|until|up|very|was|wasnt|we|weve|were|what|whats|when|where|which|while|who|whos|whom|why|with|wont|would)$/;
function isNotStopWord(term: string): boolean {
  return !stopwords.test(term);
}

function removeStopWords(terms: string[]): string[] {
  return terms.filter(isNotStopWord);
}

// eslint-disable-next-line
export type TransformMapping = { [key: string]: (orig: any) => any };

export function useSearch<T>(
  objects: T[],
  fields: string[],
  transform?: TransformMapping
): {
  list: T[];
  isFiltered: boolean;
  searchInputProps: {
    value: string;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  };
} {
  const [value, setValue] = useState("");
  const searchIndex = useMemo(() => {
    return index<T>(objects, fields, transform);
  }, [objects, transform]);

  const isFiltered = value.length >= 2;

  const list = isFiltered ? search<T>(searchIndex, value) : objects;

  return {
    list,
    isFiltered,
    searchInputProps: {
      value,
      onChange: (e: ChangeEvent<HTMLInputElement>): void => {
        setValue(e.target.value);
      },
    },
  };
}

export function index<T>(
  objects: T[],
  fields: string[],
  transform?: TransformMapping
): IndexedObject<T>[] {
  return objects.map((o) => {
    const indexed: Record<string, string[]> = { all: [] };
    fields.forEach((k) => {
      let vals: string[] = [];

      const val = transform && transform[k] ? transform[k](o[k]) : o[k];
      if (Array.isArray(val)) {
        vals = [];
        val.forEach((v) => {
          vals = vals.concat(removeStopWords(tokenize("" + v)));
        });
      } else if (val) {
        vals = removeStopWords(tokenize("" + val));
      }

      indexed[k] = vals;
      indexed.all = indexed.all.concat(vals);
    });

    return {
      index: indexed,
      source: o,
    };
  });
}

export function search<T>(index: IndexedObject<T>[], q: string): T[] {
  // Parse query
  const terms = tokenize(q).map((t) => {
    const [field, value] = t.split(":", 2);
    if (value) {
      return {
        field,
        value,
      };
    } else {
      return {
        field: "all",
        value: field,
      };
    }
  });

  const scores = new Map<T, number>();

  const res = index
    .filter((obj) => {
      let score = 0;
      terms.forEach(({ field, value }, i) => {
        const multiplier = field === "all" ? 1 : 2;
        if (i === terms.length - 1) {
          if (
            obj.index[field] &&
            obj.index[field]
              .map((v) => v.substr(0, value.length))
              .includes(value)
          ) {
            score += (value.length / 5) * multiplier;
          }
        } else if (isNotStopWord(value)) {
          if (obj.index[field] && obj.index[field].includes(value)) {
            score += (value.length / 5) * multiplier;
          }
        }
      });
      scores.set(obj.source, score);
      return score > 0;
    })
    .map((obj) => obj.source);

  res.sort((a, b) => scores.get(b) - scores.get(a));

  return res;
}

export function useSort<T>(
  items: T[],
  defaultField: string,
  defaultDir: number = 1,
  compFunctions?: Record<string, (a: T, b: T) => number>
) {
  const [sort, setSort] = useState({
    field: defaultField,
    dir: defaultDir,
  });
  const sorted = useMemo(() => {
    const sorted = [...items];
    sorted.sort((a, b) => {
      if (compFunctions && sort.field in compFunctions) {
        return compFunctions[sort.field](a, b) * sort.dir;
      }

      const comp1 = a[sort.field];
      const comp2 = b[sort.field];
      if (typeof comp1 === "string") {
        return comp1.localeCompare(comp2) * sort.dir;
      }
      return (comp1 - comp2) * sort.dir;
    });
    return sorted;
  }, [sort, items]);

  const SortableTH = useMemo(() => {
    const th: FC<{
      field: string;
      className?: string;
    }> = ({ children, field, className = "" }) => (
      <th className={className}>
        <span
          className="cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            setSort({
              field,
              dir: sort.field === field ? sort.dir * -1 : 1,
            });
          }}
        >
          {children}{" "}
          <a
            href="#"
            className={sort.field === field ? "activesort" : "inactivesort"}
          >
            {sort.field === field ? (
              sort.dir < 0 ? (
                <FaSortDown />
              ) : (
                <FaSortUp />
              )
            ) : (
              <FaSort />
            )}
          </a>
        </span>
      </th>
    );
    return th;
  }, [sort.dir, sort.field]);

  return {
    sorted,
    SortableTH,
  };
}
