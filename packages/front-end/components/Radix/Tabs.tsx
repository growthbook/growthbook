import clsx from "clsx";
import { Tabs as RadixTabs } from "@radix-ui/themes";
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

export function Tabs({
  children,
  defaultValue,
  value,
  onValueChange,
  persistInURL = false,
  ...props
}: TabsProps) {
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
    <RadixTabs.Root {...rootProps} {...props}>
      {children}
    </RadixTabs.Root>
  );
}

type TabsListProps = Omit<
  React.ComponentProps<typeof RadixTabs.List>,
  "size"
> & {
  size?: "1" | "2" | "3";
};

export function TabsList({
  children,
  size = "2",
  className,
  ...props
}: TabsListProps) {
  const sizeValue = size === "3" ? "2" : size;
  const classNameValue = size === "3" ? "rt-r-size-3" : "";

  return (
    <RadixTabs.List
      className={clsx(classNameValue, className)}
      size={sizeValue}
      {...props}
    >
      {children}
    </RadixTabs.List>
  );
}

export function TabsTrigger({
  children,
  ...props
}: React.ComponentProps<typeof RadixTabs.Trigger>) {
  return <RadixTabs.Trigger {...props}>{children}</RadixTabs.Trigger>;
}

export function TabsContent({
  children,
  ...props
}: React.ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content {...props}>{children}</RadixTabs.Content>;
}
