import {
  FC,
  useState,
  Children,
  isValidElement,
  cloneElement,
  ReactNode,
} from "react";
import clsx from "clsx";
import Modal from "./Modal";
import DeleteButton from "./DeleteButton/DeleteButton";

const Carousel: FC<{
  deleteImage?: (i: number) => Promise<void>;
  children: ReactNode;
}> = ({ children, deleteImage }) => {
  const [active, setActive] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  const num = Children.count(children);

  const current = active >= num ? num - 1 : active;

  let currentChild = null;
  if (modalOpen) {
    const orig = Children.toArray(children)[current];
    if (orig && isValidElement(orig)) {
      currentChild = cloneElement(orig, {
        style: { ...orig.props.style, height: "100%" },
      });
    }
  }

  return (
    <div className="carousel slide my-2">
      {modalOpen && currentChild && (
        <Modal
          open={true}
          header={"Screenshot"}
          close={() => setModalOpen(false)}
          size="max"
        >
          {currentChild}
          {deleteImage && (
            <DeleteButton
              displayName="Screenshot"
              onClick={async () => {
                await deleteImage(current);
                setModalOpen(false);
              }}
              outline={false}
              style={{
                position: "absolute",
                top: 20,
                right: 20,
              }}
            />
          )}
        </Modal>
      )}
      <div className="carousel-inner">
        {Children.map(children, (child, i) => {
          if (!isValidElement(child)) return null;
          return (
            <div
              className={clsx("carousel-item cursor-pointer", {
                active: i === current,
              })}
              onClick={() => setModalOpen(true)}
              key={i}
            >
              {child}
            </div>
          );
        })}
      </div>
      {current > 0 ? (
        <a
          className="carousel-control-prev"
          href="#"
          role="button"
          style={{ backgroundColor: "rgba(68,68,68,.4)" }}
          onClick={(e) => {
            e.preventDefault();
            setActive((current + num - 1) % num);
          }}
        >
          <span
            className="carousel-control-prev-icon"
            aria-hidden="true"
          ></span>
          <span className="sr-only">Previous</span>
        </a>
      ) : (
        ""
      )}
      {current < num - 1 ? (
        <a
          className="carousel-control-next"
          href="#"
          role="button"
          style={{ backgroundColor: "rgba(68,68,68,.4)" }}
          onClick={(e) => {
            e.preventDefault();
            setActive((current + 1) % num);
          }}
        >
          <span
            className="carousel-control-next-icon"
            aria-hidden="true"
          ></span>
          <span className="sr-only">Next</span>
        </a>
      ) : (
        ""
      )}
    </div>
  );
};

export default Carousel;
