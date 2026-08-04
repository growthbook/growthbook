import { ReactNode, useState } from "react";
import { Box, Flex, Text as RadixText } from "@radix-ui/themes";
import Avatar from "./Avatar";
import Badge from "./Badge";
import Button from "./Button";
import Callout from "./Callout";
import Checkbox from "./Checkbox";
import HelperText from "./HelperText";
import Link from "./Link";
import { Select, SelectItem } from "./Select";
import Switch from "./Switch";
import Text from "./Text";
import { TshirtSize } from "./sizes";

/** Steps each component accepts, so the page can name what is absent from a row. */
const SUPPORTS: Record<string, TshirtSize[]> = {
  Avatar: ["sm", "md", "lg"],
  Badge: ["xs", "sm", "md", "lg"],
  Button: ["sm", "md", "lg", "xl"],
  Checkbox: ["sm", "md", "lg"],
  Select: ["sm", "md", "lg"],
  Switch: ["sm", "md", "lg"],
  Callout: ["sm", "md"],
  HelperText: ["sm", "md"],
  Text: ["sm", "md", "lg", "xl"],
  Link: ["sm", "md", "lg", "xl"],
};

const BREAKOUTS: [string, string][] = [
  [
    "Heading",
    "A type scale, not the control scale, so md is Radix 4. A heading at Radix 2 would render smaller than body text. Shares the names, keeps its own numbers, and is the only component that uses 2xl.",
  ],
  [
    "Modal",
    "md and lg are Radix 3 and 4. Radix Dialog sizes drive padding and radius, its own default is 3, and the visible width comes from a separate maxWidth. Not aligned yet.",
  ],
  [
    "Badge xs",
    "Radix has no step below 1, so xs is Radix 1 plus local CSS. That is why xs has no entry in the shared map.",
  ],
  [
    "Switch",
    "Compresses sm and md onto Radix 1. Radix Switch does have a third step, so this one is our own choice.",
  ],
  [
    "Tabs",
    "Radix Tabs stops at 2, so lg is Radix 2 plus an rt-r-size-3 class.",
  ],
];

function Step({
  size,
  radix,
  first,
  children,
}: {
  size: TshirtSize;
  radix?: string;
  first?: boolean;
  children: ReactNode;
}) {
  const absent = Object.keys(SUPPORTS).filter(
    (name) => !SUPPORTS[name].includes(size),
  );
  return (
    <Box
      pt={first ? undefined : "4"}
      style={first ? undefined : { borderTop: "1px solid var(--gray-a4)" }}
    >
      <Flex direction="column" gap="3">
        <RadixText as="div" weight="bold" size="4">
          {size} {radix ? `→ Radix ${radix}` : "→ no shared step"}
        </RadixText>
        {children}
        <RadixText size="1" color="gray">
          not offered at this step: {absent.join(", ") || "nothing"}
        </RadixText>
      </Flex>
    </Box>
  );
}

export default function SizeCohesionStories() {
  const [checked, setChecked] = useState<boolean | "indeterminate">(true);
  const [toggled, setToggled] = useState(true);
  const [selected, setSelected] = useState("one");

  return (
    <Flex direction="column" gap="5">
      <Step size="xs" first>
        <Flex align="center" gap="4" wrap="wrap">
          <Badge size="xs" label="Badge" />
        </Flex>
      </Step>

      <Step size="sm" radix="1">
        <Flex align="center" gap="4" wrap="wrap">
          <Avatar size="sm">AB</Avatar>
          <Button size="sm">Button</Button>
          <Badge size="sm" label="Badge" />
          <Checkbox
            size="sm"
            label="Checkbox"
            value={checked}
            setValue={setChecked}
          />
          <Switch
            size="sm"
            label="Switch"
            value={toggled}
            onChange={setToggled}
          />
          <Box width="140px">
            <Select size="sm" value={selected} setValue={setSelected}>
              <SelectItem value="one">Select</SelectItem>
            </Select>
          </Box>
        </Flex>
        <Flex direction="column" gap="2">
          <Text size="sm">Text at sm</Text>
          <Link href="#size-cohesion" size="sm">
            Link at sm
          </Link>
          <Callout size="sm" status="info">
            Callout at sm
          </Callout>
          <HelperText size="sm" status="info">
            Helper text at sm
          </HelperText>
        </Flex>
      </Step>

      <Step size="md" radix="2">
        <Flex align="center" gap="4" wrap="wrap">
          <Avatar size="md">AB</Avatar>
          <Button size="md">Button</Button>
          <Badge size="md" label="Badge" />
          <Checkbox
            size="md"
            label="Checkbox"
            value={checked}
            setValue={setChecked}
          />
          <Switch
            size="md"
            label="Switch"
            value={toggled}
            onChange={setToggled}
          />
          <Box width="140px">
            <Select size="md" value={selected} setValue={setSelected}>
              <SelectItem value="one">Select</SelectItem>
            </Select>
          </Box>
        </Flex>
        <Flex direction="column" gap="2">
          <Text size="md">Text at md</Text>
          <Link href="#size-cohesion" size="md">
            Link at md
          </Link>
          <Callout size="md" status="info">
            Callout at md
          </Callout>
          <HelperText size="md" status="info">
            Helper text at md
          </HelperText>
        </Flex>
      </Step>

      <Step size="lg" radix="3">
        <Flex align="center" gap="4" wrap="wrap">
          <Avatar size="lg">AB</Avatar>
          <Button size="lg">Button</Button>
          <Badge size="lg" label="Badge" />
          <Checkbox
            size="lg"
            label="Checkbox"
            value={checked}
            setValue={setChecked}
          />
          <Switch
            size="lg"
            label="Switch"
            value={toggled}
            onChange={setToggled}
          />
          <Box width="140px">
            <Select size="lg" value={selected} setValue={setSelected}>
              <SelectItem value="one">Select</SelectItem>
            </Select>
          </Box>
        </Flex>
        <Flex direction="column" gap="2">
          <Text size="lg">Text at lg</Text>
          <Link href="#size-cohesion" size="lg">
            Link at lg
          </Link>
        </Flex>
      </Step>

      <Step size="xl" radix="4">
        <Flex align="center" gap="4" wrap="wrap">
          <Button size="xl">Button</Button>
        </Flex>
        <Flex direction="column" gap="2">
          <Text size="xl">Text at xl</Text>
          <Link href="#size-cohesion" size="xl">
            Link at xl
          </Link>
        </Flex>
      </Step>

      <Step size="2xl">
        <RadixText color="gray" size="2">
          Only Heading reaches this step, on its own type scale.
        </RadixText>
      </Step>

      <Box pt="4" style={{ borderTop: "1px solid var(--gray-a4)" }}>
        <Flex direction="column" gap="2">
          <RadixText as="div" weight="bold" size="4">
            Break-outs
          </RadixText>
          <RadixText color="gray" size="2">
            These use the shared names but not the shared map. Each one is
            deliberate.
          </RadixText>
          {BREAKOUTS.map(([name, why]) => (
            <RadixText key={name} as="div" size="2">
              <strong>{name}.</strong> {why}
            </RadixText>
          ))}
        </Flex>
      </Box>
    </Flex>
  );
}
