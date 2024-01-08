import {
  FC,
  useState,
  Children,
  isValidElement,
  cloneElement,
  ReactNode,
  ReactElement,
} from "react";
import clsx from "clsx";
import Modal from "./Modal";
import DeleteButton from "./DeleteButton/DeleteButton";

const Carousel: FC<{
  deleteImage?: (i: number) => Promise<void>;
  children: ReactNode;
  maxChildHeight?: number;
}> = ({ children, deleteImage, maxChildHeight }) => {
  const [active, setActive] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  const num = Children.count(children);
  if (!modalOpen && maxChildHeight) {
    children = Children.map(children, (child) => {
      return cloneElement(child as ReactElement, {
        style: {
          ...(child as ReactElement).props.style,
          maxHeight: maxChildHeight,
        },
      });
    });
  }

  const current = active >= num ? num - 1 : active;

  let currentChild: null | ReactElement = null;
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
          sizeY="max"
        >
          {currentChild}
          {deleteImage && (
            <DeleteButton
              displayName="Screenshot"
              onClick={async () => {
                await deleteImage(current);
                setModalOpen(false);
              }}
              outline={true}
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
          role="button"
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
          role="button"
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
