import React, { FC } from "react";
import ReactPaginate from "react-paginate";
import { PiCaretLeft, PiCaretRight } from "react-icons/pi";

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
    <div className={`pagination-area-radix ${className}`}>
      <ReactPaginate
        previousLabel={
          <span className="pagination-arrow">
            <PiCaretLeft size={14} />
          </span>
        }
        nextLabel={
          <span className="pagination-arrow">
            <PiCaretRight size={14} />
          </span>
        }
        breakLabel={"..."}
        breakClassName={"pagination-break"}
        pageCount={Math.ceil(numItemsTotal / perPage)}
        marginPagesDisplayed={2}
        pageRangeDisplayed={3}
        forcePage={currentPage - 1}
        onPageChange={(d) => {
          onPageChange(d.selected + 1);
        }}
        containerClassName={"pagination-radix-container"}
        pageClassName={"pagination-page"}
        disabledClassName={"pagination-disabled"}
        pageLinkClassName={"pagination-link"}
        previousClassName={"pagination-arrow-container"}
        nextClassName={"pagination-arrow-container"}
        nextLinkClassName={"pagination-link-arrow"}
        previousLinkClassName={"pagination-link-arrow"}
        activeClassName={"pagination-active"}
      />
    </div>
  );
};

export default Pagination;
