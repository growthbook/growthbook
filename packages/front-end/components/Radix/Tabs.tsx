import { Tabs as RadixTabs } from "@radix-ui/themes";

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
