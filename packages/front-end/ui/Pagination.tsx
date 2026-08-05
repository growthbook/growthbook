import React, { CSSProperties, FC } from "react";
import { PiCaretLeft, PiCaretRight } from "react-icons/pi";
import clsx from "clsx";
import styles from "./Pagination.module.scss";

export type PaginationItem =
  | { type: "page"; page: number }
  | { type: "ellipsis"; side: "start" | "end" };

export type PaginationModel = {
  /** Integer >= 0. Non-finite or negative input degrades to 0. */
  pageCount: number;
  /** Integer clamped to [1, max(pageCount, 1)]. */
  currentPage: number;
  /** Constant length for a given pageCount: min(pageCount, SLOT_COUNT). */
  items: PaginationItem[];
};

const BOUNDARY_COUNT = 1; // pages pinned at each end
const SIBLING_COUNT = 1; // pages shown on each side of the current page
const SLOT_COUNT = 2 * BOUNDARY_COUNT + 2 * SIBLING_COUNT + 3;

function getPageItems(start: number, end: number): PaginationItem[] {
  return Array.from({ length: Math.max(end - start + 1, 0) }, (_, index) => ({
    type: "page",
    page: start + index,
  }));
}

// A gap hiding a single page renders that page instead, so the slot count stays
// the same as when an ellipsis is needed.
function getGapItems(
  side: "start" | "end",
  from: number,
  to: number,
): PaginationItem[] {
  const hiddenCount = to - from + 1;
  if (hiddenCount <= 0) return [];
  if (hiddenCount === 1) return getPageItems(from, to);
  return [{ type: "ellipsis", side }];
}

export function getPaginationModel({
  pageCount: pageCountInput,
  currentPage: currentPageInput,
}: {
  pageCount: number;
  currentPage: number;
}): PaginationModel {
  const pageCount = Number.isFinite(pageCountInput)
    ? Math.max(0, Math.floor(pageCountInput))
    : 0;
  const currentPage = Number.isFinite(currentPageInput)
    ? Math.min(
        Math.max(1, Math.floor(currentPageInput)),
        Math.max(pageCount, 1),
      )
    : 1;

  if (pageCount <= SLOT_COUNT) {
    return {
      pageCount,
      currentPage,
      items: getPageItems(1, pageCount),
    };
  }

  // Clamping the window so it slides toward the far side near an edge, rather
  // than centering it on the current page, is what keeps the slot count constant.
  const start = Math.max(
    Math.min(
      currentPage - SIBLING_COUNT,
      pageCount - BOUNDARY_COUNT - 2 * SIBLING_COUNT - 1,
    ),
    BOUNDARY_COUNT + 2,
  );
  const end = Math.min(
    Math.max(
      currentPage + SIBLING_COUNT,
      BOUNDARY_COUNT + 2 * SIBLING_COUNT + 2,
    ),
    pageCount - BOUNDARY_COUNT - 1,
  );

  return {
    pageCount,
    currentPage,
    items: [
      ...getPageItems(1, BOUNDARY_COUNT),
      ...getGapItems("start", BOUNDARY_COUNT + 1, start - 1),
      ...getPageItems(start, end),
      ...getGapItems("end", end + 1, pageCount - BOUNDARY_COUNT),
      ...getPageItems(pageCount - BOUNDARY_COUNT + 1, pageCount),
    ],
  };
}

type PaginationProps = {
  numItemsTotal: number;
  perPage: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  className?: string;
};

const Pagination: FC<PaginationProps> = ({
  numItemsTotal,
  perPage,
  currentPage,
  onPageChange,
  className = "",
}) => {
  const model = getPaginationModel({
    pageCount: Math.ceil(numItemsTotal / perPage),
    currentPage,
  });
  const slotStyle: CSSProperties = {
    minWidth: `max(32px, calc(${String(Math.max(model.pageCount, 1)).length}ch + 6px))`,
  };

  return (
    <nav aria-label="Pagination" className={clsx(styles.root, className)}>
      <ul className={styles.container}>
        <li>
          <button
            type="button"
            className={styles.linkArrow}
            disabled={model.currentPage <= 1}
            onClick={() => onPageChange(model.currentPage - 1)}
          >
            <PiCaretLeft size={14} />
            Prev
          </button>
        </li>
        {model.items.map((item) => {
          switch (item.type) {
            case "page": {
              const isCurrent = item.page === model.currentPage;
              return (
                <li key={item.page} style={slotStyle}>
                  <button
                    type="button"
                    className={clsx(
                      styles.link,
                      isCurrent && styles.linkActive,
                    )}
                    aria-current={isCurrent ? "page" : undefined}
                    aria-label={`Go to page ${item.page}`}
                    onClick={() => {
                      if (!isCurrent) onPageChange(item.page);
                    }}
                  >
                    {item.page}
                  </button>
                </li>
              );
            }
            case "ellipsis":
              return (
                <li
                  key={item.side}
                  className={styles.break}
                  style={slotStyle}
                  aria-hidden="true"
                >
                  …
                </li>
              );
            default: {
              const exhaustiveCheck: never = item;
              return exhaustiveCheck;
            }
          }
        })}
        <li>
          <button
            type="button"
            className={styles.linkArrow}
            disabled={model.currentPage >= model.pageCount}
            onClick={() => onPageChange(model.currentPage + 1)}
          >
            Next
            <PiCaretRight size={14} />
          </button>
        </li>
      </ul>
    </nav>
  );
};

export default Pagination;
