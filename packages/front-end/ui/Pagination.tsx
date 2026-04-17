import React, { FC } from "react";
import ReactPaginate from "react-paginate";
import { PiCaretLeft, PiCaretRight } from "react-icons/pi";
import clsx from "clsx";
import styles from "./Pagination.module.scss";

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
