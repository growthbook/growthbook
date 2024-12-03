import { Tabs as RadixTabs } from "@radix-ui/themes";

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

export function Tabs({
  children,
  ...props
}: React.ComponentProps<typeof RadixTabs.Root>) {
  return <RadixTabs.Root {...props}>{children}</RadixTabs.Root>;
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
