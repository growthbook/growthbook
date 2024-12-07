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
};

type UncontrolledTabsProps = {
  defaultValue?: string;
  value?: never;
};

type TabsProps = (ControlledTabsProps | UncontrolledTabsProps) &
  Omit<React.ComponentProps<typeof RadixTabs.Root>, "defaultValue" | "value">;

export function Tabs({
  children,
  defaultValue,
  value,
  onValueChange,
  ...props
}: TabsProps) {
  let innerValue: string | undefined;
  let innerOnValueChange: ((value: string) => void) | undefined;

  // For uncontrolled tabs always set the value in URL
  const [urlHash, setUrlHash] = useURLHash();
  if (defaultValue) {
    innerValue = urlHash ?? defaultValue;
    innerOnValueChange = (value) => {
      setUrlHash(value as string);
      onValueChange?.(value);
    };
  } else {
    innerValue = value;
    innerOnValueChange = onValueChange;
  }

  return (
    <RadixTabs.Root
      value={innerValue}
      onValueChange={innerOnValueChange}
      {...props}
    >
      {children}
    </RadixTabs.Root>
  );
}

export function TabsList({
  children,
  ...props
}: React.ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List {...props}>{children}</RadixTabs.List>;
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
