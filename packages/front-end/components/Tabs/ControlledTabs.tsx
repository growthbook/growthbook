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
import TabButton from "./TabButton";
import TabButtons from "./TabButtons";

const ControlledTabs: FC<{
  orientation?: "vertical" | "horizontal";
  className?: string;
  navClassName?: string;
  buttonsWrapperClassName?: string;
  tabContentsClassName?: string | ((tab: string | null) => string);
  defaultTab?: string;
  newStyle?: boolean;
  navExtra?: ReactElement;
  active?: string | null;
  setActive: (tab: string | null) => void;
  showActiveCount?: boolean;
  buttonsClassName?: string | ((tab: string | null) => string);
  children: ReactNode;
}> = ({
  active,
  setActive,
  children,
  orientation,
  className,
  tabContentsClassName,
  navClassName,
  buttonsWrapperClassName,
  defaultTab,
  newStyle = false,
  navExtra,
  showActiveCount = false,
  buttonsClassName = "",
}) => {
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
    const id = child.props?.id ?? display;
    if (anchor) {
      anchorMap.set(anchor, id);
    }

    if (!activeChosen && visible !== false && active === id) {
      activeChosen = id;
    } else if (!activeChosen && visible !== false && !backupActive) {
      backupActive = id;
    }
  });
  if (!activeChosen) {
    activeChosen = backupActive;
  }

  let contentsPadding = true;
  const numTabs = Children.toArray(children).filter((c) => {
    return !!c;
  }).length;

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
      padding,
      forceRenderOnFocus,
    } = child.props;
    if (visible === false) return;
    const id = child.props?.id ?? display;

    const isActive = id === activeChosen;

    if (isActive && padding === false) {
      contentsPadding = false;
    }

    tabs.push(
      <TabButton
        active={isActive}
        last={i === numTabs - 1}
        newStyle={newStyle}
        key={i}
        anchor={anchor}
        onClick={() => {
          setActive(id);
        }}
        display={display}
        count={count}
        action={action}
        showActiveCount={showActiveCount}
        className={
          typeof buttonsClassName === "function"
            ? buttonsClassName(id)
            : buttonsClassName
        }
      />,
    );

    if (lazy && !isActive && !loaded[id]) {
      contents.push(null);
    } else if (!isActive && forceRenderOnFocus) {
      contents.push(null);
    } else {
      contents.push(
        <div
          className={clsx("tab-pane", className, { active: isActive })}
          role="tabpanel"
          key={i}
        >
          {child}
        </div>,
      );
    }
  });

  useEffect(() => {
    // @ts-expect-error TS(2538) If you come across this, please fix it!: Type 'null' cannot be used as an index type.
    if (!loaded[active]) {
      setLoaded({
        ...loaded,
        // @ts-expect-error TS(2464) If you come across this, please fix it!: A computed property name must be of type 'string',... Remove this comment to see the full error message
        [active]: true,
      });
    }
  }, [active]);

  useEffect(() => {
    const handler = () => {
      const hash = window.location.hash.replace(/^#/, "");
      const id = anchorMap.get(hash);
      if (id) {
        setActive(id);
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
        buttontabs: newStyle,
      })}
    >
      <nav
        className={clsx(navClassName, {
          "col-md-3": orientation === "vertical",
        })}
      >
        <TabButtons
          newStyle={newStyle}
          vertical={orientation === "vertical"}
          className={buttonsWrapperClassName}
        >
          {tabs}
          {navExtra && navExtra}
        </TabButtons>
      </nav>
      <div
        className={clsx(
          "appbox",
          typeof tabContentsClassName === "function"
            ? tabContentsClassName(activeChosen)
            : tabContentsClassName,
          {
            "col-md-9": orientation === "vertical",
            "p-3": contentsPadding,
            "p-0": !contentsPadding,
            "border-top-0": !newStyle,
          },
        )}
      >
        {contents}
      </div>
    </div>
  );
};

export default ControlledTabs;
