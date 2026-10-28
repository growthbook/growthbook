import {
  FC,
  useState,
  Children,
  isValidElement,
  cloneElement,
  ReactNode,
  ReactElement,
} from "react";
import { PiCaretLeft, PiCaretRight } from "react-icons/pi";
import clsx from "clsx";
import styles from "./Carousel.module.scss";

const Carousel: FC<{
  children: ReactNode;
  maxChildHeight?: number;
  // The arrows centre on this much of the top, so whichever image shows, and
  // however tall, they stay put.
  minHeight?: number;
  onClick?: (i: number) => void;
}> = ({ children, maxChildHeight, minHeight, onClick }) => {
  const [active, setActive] = useState(0);

  const num = Children.count(children);
  if (maxChildHeight) {
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
  const controlPosition = minHeight
    ? { bottom: "auto", height: minHeight }
    : undefined;

  return (
    <div className="carousel slide">
      <div
        className={clsx("carousel-inner", styles.slides)}
        style={{ minHeight }}
      >
        {Children.map(children, (child, i) => {
          if (!isValidElement(child)) return null;
          return (
            <div
              className={clsx(
                "cursor-pointer",
                styles.slide,
                i === current && styles.active,
              )}
              onClick={() => {
                if (onClick) onClick(i);
              }}
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
          style={controlPosition}
          role="button"
          onClick={(e) => {
            e.preventDefault();
            setActive((current + num - 1) % num);
          }}
        >
          <span className="carousel-control-prev-icon" aria-hidden="true">
            <PiCaretLeft />
          </span>
          <span className="sr-only">Previous</span>
        </a>
      ) : (
        ""
      )}
      {current < num - 1 ? (
        <a
          className="carousel-control-next"
          style={controlPosition}
          role="button"
          onClick={(e) => {
            e.preventDefault();
            setActive((current + 1) % num);
          }}
        >
          <span className="carousel-control-next-icon" aria-hidden="true">
            <PiCaretRight />
          </span>
          <span className="sr-only">Next</span>
        </a>
      ) : (
        ""
      )}
    </div>
  );
};

export default Carousel;
