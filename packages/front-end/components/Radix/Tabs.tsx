import clsx from "clsx";
import { forwardRef, useEffect, useRef, useState } from "react";
import { Box, Tabs as RadixTabs } from "@radix-ui/themes";
import useURLHash from "@/hooks/useURLHash";
import { useScrollPosition } from "@/hooks/useScrollPosition";

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
  ref
) {
  let rootProps: React.ComponentProps<typeof RadixTabs.Root> = {};

  const [urlHash, setUrlHash] = useURLHash();

  if (defaultValue && persistInURL) {
    rootProps = {
      value: urlHash ?? defaultValue,
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
  }
);

type StickyTabsListProps = { pinnedClass?: string } & TabsListProps;

export const StickyTabsList = forwardRef<HTMLDivElement, StickyTabsListProps>(
  function StickyTabsList({ pinnedClass = "pinned", ...props }, ref) {
    // NB: Keep in sync with .experiment-tabs top property in global.scss
    const TABS_HEADER_HEIGHT_PX = 55;
    const tabsRef = useRef<HTMLDivElement>(null);
    const [headerPinned, setHeaderPinned] = useState(false);
    const { scrollY } = useScrollPosition();
    useEffect(() => {
      if (!tabsRef.current) return;
      const isHeaderSticky =
        tabsRef.current.getBoundingClientRect().top <= TABS_HEADER_HEIGHT_PX;
      setHeaderPinned(isHeaderSticky);
    }, [scrollY]);

    return (
      <Box
        className={`${headerPinned ? pinnedClass || "" : ""} tabwrap sticky`}
        ref={tabsRef}
        style={{ top: TABS_HEADER_HEIGHT_PX + "px" }}
      >
        <TabsList {...props} ref={ref} />
      </Box>
    );
  }
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
