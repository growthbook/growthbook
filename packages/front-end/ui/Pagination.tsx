import React, { CSSProperties, FC } from "react";
import { PiCaretLeft, PiCaretRight } from "react-icons/pi";
import clsx from "clsx";
import styles from "./Pagination.module.scss";

export type PaginationItem =
  | { type: "page"; page: number }
  | { type: "ellipsis"; side: "start" | "end" };

export type PaginationModel = {
  pageCount: number;
  currentPage: number;
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

/** A 1-page gap renders that page so the slot count stays constant. */
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

  // Slide the window toward the far edge instead of centering, so slot count stays constant.
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
            className={clsx(styles.button, styles.arrow)}
            aria-label="Go to previous page"
            disabled={model.currentPage <= 1}
            onClick={() => onPageChange(model.currentPage - 1)}
          >
            <PiCaretLeft size={15} />
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
                      styles.button,
                      styles.page,
                      isCurrent && styles.current,
                    )}
                    aria-current={isCurrent ? "page" : undefined}
                    aria-label={
                      isCurrent
                        ? `Page ${item.page}`
                        : `Go to page ${item.page}`
                    }
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
            className={clsx(styles.button, styles.arrow)}
            aria-label="Go to next page"
            disabled={model.currentPage >= model.pageCount}
            onClick={() => onPageChange(model.currentPage + 1)}
          >
            <PiCaretRight size={15} />
          </button>
        </li>
      </ul>
    </nav>
  );
};

export default Pagination;
