import React, { FC } from "react";
import ReactPaginate from "react-paginate";
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

  // Clamping the window keeps the slot count constant.
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
      ...(start > BOUNDARY_COUNT + 2
        ? [{ type: "ellipsis", side: "start" } satisfies PaginationItem]
        : start === BOUNDARY_COUNT + 2
          ? getPageItems(BOUNDARY_COUNT + 1, BOUNDARY_COUNT + 1)
          : []),
      ...getPageItems(start, end),
      ...(end < pageCount - BOUNDARY_COUNT - 1
        ? [{ type: "ellipsis", side: "end" } satisfies PaginationItem]
        : end === pageCount - BOUNDARY_COUNT - 1
          ? getPageItems(pageCount - BOUNDARY_COUNT, pageCount - BOUNDARY_COUNT)
          : []),
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
  return (
    <div className={clsx(styles.root, className)}>
      <ReactPaginate
        previousLabel={
          <span className={styles.arrow}>
            <PiCaretLeft size={14} />
            Prev
          </span>
        }
        nextLabel={
          <span className={styles.arrow}>
            Next
            <PiCaretRight size={14} />
          </span>
        }
        breakLabel={"..."}
        breakClassName={styles.break}
        pageCount={Math.ceil(numItemsTotal / perPage)}
        marginPagesDisplayed={2}
        pageRangeDisplayed={3}
        forcePage={currentPage - 1}
        onPageChange={(d) => {
          onPageChange(d.selected + 1);
        }}
        containerClassName={styles.container}
        pageClassName={styles.page}
        disabledClassName={styles.disabled}
        pageLinkClassName={styles.link}
        previousClassName={styles.arrowContainer}
        nextClassName={styles.arrowContainer}
        nextLinkClassName={styles.linkArrow}
        previousLinkClassName={styles.linkArrow}
        activeClassName={styles.pageActive}
      />
    </div>
  );
};

export default Pagination;
