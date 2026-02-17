import clsx from "clsx";
import {
  Children,
  forwardRef,
  isValidElement,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Box, Tabs as RadixTabs } from "@radix-ui/themes";
import useURLHash from "@/hooks/useURLHash";

/**
 * See more examples in design-system/index.tsx
 *
 * Simple usage:
 * ```tsx
 * <Tabs defaultValue="tab1">
 *   <TabsList>
 *     <TabsTrigger value="tab1">Tab 1</TabsTrigger>
 *     <TabsTrigger value="tab2">Tab 2</TabsTrigger>
 *   </TabsList>
 *   <TabsContent value="tab1">Content for tab 1</TabsContent>
 *   <TabsContent value="tab2">Content for tab 2</TabsContent>
 * </Tabs>
 * ```
 */

type ControlledTabsProps = {
  defaultValue?: never;
  value?: string;
  persistInURL?: never;
};

type UncontrolledTabsProps = {
  defaultValue?: string;
  value?: never;
  persistInURL?: boolean;
};

type TabsProps = (ControlledTabsProps | UncontrolledTabsProps) &
  Omit<React.ComponentProps<typeof RadixTabs.Root>, "defaultValue" | "value">;

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  {
    children,
    defaultValue,
    value,
    onValueChange,
    persistInURL = false,
    ...props
  }: TabsProps,
  ref,
) {
  let rootProps: React.ComponentProps<typeof RadixTabs.Root> = {};

  const [urlHash, setUrlHash] = useURLHash();

  if (defaultValue && persistInURL) {
    const possibleValues = new Set<string>();
    Children.forEach(children, (child) => {
      if (
        isValidElement(child) &&
        child.props &&
        typeof child.props === "object" &&
        "value" in child.props &&
        typeof child.props.value === "string"
      ) {
        possibleValues.add(child.props.value);
      } else if (
        isValidElement(child) &&
        child.props &&
        typeof child.props === "object" &&
        "children" in child.props &&
        Array.isArray(child.props.children)
      ) {
        // If the child is a TabsTrigger, check its children for a value
        child.props.children.forEach((c: ReactNode) => {
          if (
            isValidElement(c) &&
            c.props &&
            typeof c.props === "object" &&
            "value" in c.props &&
            typeof c.props.value === "string"
          ) {
            possibleValues.add(c.props.value);
          }
        });
      }
      return null;
    });

    rootProps = {
      value:
        urlHash && (possibleValues.has(urlHash) || !possibleValues.size)
          ? urlHash
          : defaultValue,
      onValueChange: (value) => {
        setUrlHash(value as string);
        onValueChange?.(value);
      },
    };
  } else if (defaultValue) {
    rootProps = {
      defaultValue,
    };
  } else if (value) {
    rootProps = {
      value,
      onValueChange,
    };
  }

  return (
    <RadixTabs.Root {...rootProps} {...props} ref={ref}>
      {children}
    </RadixTabs.Root>
  );
});

type TabsListProps = Omit<
  React.ComponentProps<typeof RadixTabs.List>,
  "size"
> & {
  size?: "1" | "2" | "3";
};

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  function TabsList({ children, size = "2", className, ...props }, ref) {
    const sizeValue = size === "3" ? "2" : size;
    const classNameValue = size === "3" ? "rt-r-size-3" : "";

    return (
      <RadixTabs.List
        className={clsx(classNameValue, className)}
        size={sizeValue}
        {...props}
        ref={ref}
      >
        {children}
      </RadixTabs.List>
    );
  },
);

type StickyTabsListProps = { pinnedClass?: string } & TabsListProps;

export const StickyTabsList = forwardRef<HTMLDivElement, StickyTabsListProps>(
  function StickyTabsList({ pinnedClass = "pinned", ...props }, ref) {
    // NB: Keep in sync with .experiment-tabs top property in global.scss
    const TABS_HEADER_HEIGHT_PX = 55;
    const tabsRef = useRef<HTMLDivElement>(null);
    const [headerPinned, setHeaderPinned] = useState(false);

    useEffect(() => {
      const observer = new IntersectionObserver(
        ([entry]) => {
          setHeaderPinned(entry.intersectionRatio < 1);
        },
        {
          root: null, // Use the viewport as the root
          rootMargin: `-${TABS_HEADER_HEIGHT_PX}px`,
          threshold: 0.01, // Trigger when first pixel leaves
        },
      );
      if (tabsRef.current) {
        observer.observe(tabsRef.current);
      }
      return () => observer.disconnect();
    }, []);

    return (
      <Box
        className={`${headerPinned ? pinnedClass || "" : ""} tabwrap sticky`}
        style={{ top: TABS_HEADER_HEIGHT_PX + "px" }}
      >
        {/* This is needed as for some reason the intersection observer doesn't work on the position:sticky element-even with the right margin offsets. */}
        <Box
          ref={tabsRef}
          style={{
            position: "absolute",
            top: -1,
          }}
        ></Box>
        <TabsList {...props} ref={ref} />
      </Box>
    );
  },
);

export const TabsTrigger = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof RadixTabs.Trigger>
>(function TabsTrigger({ children, ...props }, ref) {
  return (
    <RadixTabs.Trigger {...props} ref={ref}>
      {children}
    </RadixTabs.Trigger>
  );
});

export const TabsContent = forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof RadixTabs.Content>
>(function TabsContent({ children, ...props }, ref) {
  return (
    <RadixTabs.Content {...props} ref={ref}>
      {children}
    </RadixTabs.Content>
  );
});
