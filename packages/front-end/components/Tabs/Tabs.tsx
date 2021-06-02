import {
  FC,
  Children,
  useState,
  isValidElement,
  ReactNode,
  ReactElement,
  useEffect,
} from "react";
import clsx from "clsx";

const Tabs: FC<{
  orientation?: "vertical" | "horizontal";
  className?: string;
  navClassName?: string;
  tabContentsClassName?: string;
  defaultTab?: string;
}> = ({
  children,
  orientation,
  className,
  tabContentsClassName,
  navClassName,
  defaultTab,
}) => {
  const [active, setActive] = useState<string | null>(defaultTab || null);

  const [loaded, setLoaded] = useState({});

  const tabs: ReactElement[] = [];

  const contents: ReactNode[] = [];

  useEffect(() => {
    if (!active && defaultTab) {
      setActive(defaultTab);
    }
  }, [defaultTab, active]);

  const anchorMap = new Map<string, string>();
  let activeChosen = null;
  let backupActive = null;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const { display, anchor, visible } = child.props;
    if (anchor) {
      anchorMap.set(anchor, display);
    }

    if (!activeChosen && visible !== false && active === display) {
      activeChosen = display;
    } else if (!activeChosen && visible !== false && !backupActive) {
      backupActive = display;
    }
  });
  if (!activeChosen) {
    activeChosen = backupActive;
  }

  Children.forEach(children, (child, i) => {
    if (!isValidElement(child)) return;
    const {
      display,
      count,
      anchor,
      lazy,
      visible,
      action,
      className,
    } = child.props;
    if (visible === false) return;

    const isActive = display === activeChosen;

    tabs.push(
      <a
        className={clsx("nav-item nav-link", {
          active: isActive,
        })}
        key={i}
        role="tab"
        href={anchor ? `#${anchor}` : "#"}
        aria-selected={isActive ? "true" : "false"}
        onClick={(e) => {
          if (!anchor) {
            e.preventDefault();
          }
          setActive(display);
        }}
      >
        {display}
        {!isActive && (count === 0 || count > 0) ? (
          <span
            className={`badge badge-${count > 0 ? "info" : "secondary"} ml-2`}
          >
            {count}
          </span>
        ) : (
          ""
        )}
        {(isActive && action) || ""}
      </a>
    );

    if (lazy && !isActive && !loaded[display]) {
      contents.push(null);
    } else {
      contents.push(
        <div
          className={clsx("tab-pane", className, { active: isActive })}
          role="tabpanel"
          key={i}
        >
          {child}
        </div>
      );
    }
  });

  useEffect(() => {
    if (!loaded[active]) {
      setLoaded({
        ...loaded,
        [active]: true,
      });
    }
  }, [active]);

  useEffect(() => {
    const handler = () => {
      const hash = window.location.hash.replace(/^#/, "");
      const display = anchorMap.get(hash);
      if (display) {
        setActive(display);
      }
    };
    handler();
    window.addEventListener("hashchange", handler, false);
    return () => window.removeEventListener("hashchange", handler, false);
  }, []);

  return (
    <div
      className={clsx(className, {
        row: orientation === "vertical",
      })}
    >
      <nav
        className={clsx(navClassName, {
          "col-md-3": orientation === "vertical",
        })}
      >
        <div
          className={
            orientation === "vertical"
              ? "nav nav-pills flex-column"
              : "nav nav-tabs"
          }
          role="tablist"
        >
          {tabs}
        </div>
      </nav>
      <div
        className={clsx(
          "tab-content bg-white p-3 border border-top-0",
          tabContentsClassName,
          {
            "col-md-9": orientation === "vertical",
          }
        )}
      >
        {contents}
      </div>
    </div>
  );
};

export default Tabs;
