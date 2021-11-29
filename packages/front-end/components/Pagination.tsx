import React, { FC } from "react";
import ReactPaginate from "react-paginate";
import { GBArrowLeft, GBArrowRight } from "./Icons";

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
    <div className={`pagination-area ${className}`}>
      <ReactPaginate
        previousLabel={
          <>
            <GBArrowLeft /> previous
          </>
        }
        nextLabel={
          <>
            next <GBArrowRight />
          </>
        }
        breakLabel={"..."}
        breakClassName={"break-me"}
        pageCount={Math.ceil(numItemsTotal / perPage)}
        marginPagesDisplayed={2}
        pageRangeDisplayed={5}
        initialPage={currentPage - 1}
        onPageChange={(d) => {
          onPageChange(parseInt(d.selected) + 1);
        }}
        containerClassName={`pagination justify-content-center mb-0`}
        pageClassName={"page-item"}
        disabledClassName={"disabled"}
        pageLinkClassName={"page-link link-number"}
        previousClassName={"page-item"}
        nextClassName={"page-item"}
        nextLinkClassName={"page-link link-text link-text-next"}
        previousLinkClassName={"page-link link-text link-text-prev"}
        activeClassName={"active"}
      />
    </div>
  );
};
export default Pagination;
