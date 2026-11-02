import {
  FC,
  useState,
  Children,
  isValidElement,
  cloneElement,
  ReactNode,
  ReactElement,
  KeyboardEvent,
  useEffect,
  useRef,
} from "react";
import { Flex, IconButton, Theme } from "@radix-ui/themes";
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
  const prevButton = useRef<HTMLButtonElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  // An arrow disables at the end it reaches; once it has, focus moves to the
  // other one rather than dropping out of the ribbon.
  const refocus = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    refocus.current?.focus();
    refocus.current = null;
  }, [current]);
  const page = (to: number) => {
    setActive(to);
    if (to === 0) refocus.current = nextButton.current;
    else if (to === num - 1) refocus.current = prevButton.current;
  };

  return (
    <div className={clsx("carousel", styles.carousel)}>
      <div className="carousel-inner">
        {Children.map(children, (child, i) => {
          if (!isValidElement(child)) return null;
          return (
            <div
              className={clsx(
                onClick && "cursor-pointer",
                styles.slide,
                i === current && styles.active,
              )}
              key={i}
              {...(onClick
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": `Open image ${i + 1} of ${num}`,
                    onClick: () => onClick(i),
                    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      onClick(i);
                    },
                  }
                : {})}
            >
              {child}
            </div>
          );
        })}
      </div>
      {num > 1 ? (
        // Pinned to the top, so it stays put whatever each image's height;
        // the count's fixed width spaces it from the arrows. Dark in either
        // theme, as an overlay on an image reads best.
        <Theme appearance="dark" hasBackground={false} asChild>
          <Flex align="center" className={styles.ribbon}>
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              radius="full"
              size="2"
              aria-label="Previous image"
              // Radix ghost buttons carry a negative margin.
              style={{ margin: 0 }}
              ref={prevButton}
              disabled={current === 0}
              onClick={() => page(current - 1)}
            >
              <PiCaretLeft size={16} />
            </IconButton>
            <span
              className={styles.count}
              aria-live="polite"
              aria-atomic="true"
            >
              <Text size="sm" color="text-mid" whiteSpace="nowrap">
                {current + 1} of {num}
              </Text>
            </span>
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              radius="full"
              size="2"
              aria-label="Next image"
              style={{ margin: 0 }}
              ref={nextButton}
              disabled={current === num - 1}
              onClick={() => page(current + 1)}
            >
              <PiCaretRight size={16} />
            </IconButton>
          </Flex>
        </Theme>
      ) : null}
    </div>
  );
};

export default Carousel;
