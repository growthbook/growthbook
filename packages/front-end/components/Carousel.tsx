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

const Carousel: FC<{
  children: ReactNode;
  maxChildHeight?: number;
  onClick?: (i: number) => void;
}> = ({ children, maxChildHeight, onClick }) => {
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

  return (
    <div className="carousel slide my-2">
      <div className="carousel-inner">
        {Children.map(children, (child, i) => {
          if (!isValidElement(child)) return null;
          return (
            <div
              className={clsx("carousel-item cursor-pointer", {
                active: i === current,
              })}
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
