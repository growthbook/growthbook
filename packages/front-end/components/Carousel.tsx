import {
  FC,
  useState,
  Children,
  isValidElement,
  cloneElement,
  ReactNode,
  ReactElement,
} from "react";
import { Flex, IconButton } from "@radix-ui/themes";
import { PiCaretLeft, PiCaretRight } from "react-icons/pi";
import clsx from "clsx";
import Text from "@/ui/Text";
import styles from "./Carousel.module.scss";

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
    <div className={clsx("carousel", styles.carousel)}>
      <div className="carousel-inner">
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
      {num > 1 ? (
        // Pinned to the top, so it stays put whatever each image's height.
        <Flex align="center" gap="2" className={styles.ribbon}>
          <IconButton
            type="button"
            variant="ghost"
            color="gray"
            radius="full"
            size="2"
            aria-label="Previous image"
            // Radix ghost buttons carry a negative margin.
            style={{ margin: 0 }}
            disabled={current === 0}
            onClick={() => setActive(current - 1)}
          >
            <PiCaretLeft size={16} />
          </IconButton>
          <Text color="text-mid" whiteSpace="nowrap">
            {current + 1} of {num}
          </Text>
          <IconButton
            type="button"
            variant="ghost"
            color="gray"
            radius="full"
            size="2"
            aria-label="Next image"
            style={{ margin: 0 }}
            disabled={current === num - 1}
            onClick={() => setActive(current + 1)}
          >
            <PiCaretRight size={16} />
          </IconButton>
        </Flex>
      ) : null}
    </div>
  );
};

export default Carousel;
