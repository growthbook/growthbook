import React, { useState } from "react";
import { Flex, Text, Box } from "@radix-ui/themes";
import { Popover } from "./Popover";
import Badge from "./Badge";
import Button from "./Button";
import Switch from "./Switch";

export default function PopoverStories() {
  const [controlledOpen, setControlledOpen] = useState(false);

  return (
    <Flex direction="column" gap="6">
      <Box>
        <Box className="mb-2">
          <Text weight="medium">Basic Popover</Text>
        </Box>
        <Popover
          trigger={<Button>Open Popover</Button>}
          showCloseButton={true}
          content={
            <Flex direction="column" gap="2" p="2">
              <Text>
                This is a simple popover. Click outside or press ESC to close.
              </Text>
              <Button>Generic CTA</Button>
            </Flex>
          }
        />
      </Box>

      <Box>
        <Box className="mb-2">
          <Text weight="medium">Popover with controlled state</Text>
        </Box>
        <Flex direction="column" gap="3" align="start">
          <Switch
            label="Toggle popover"
            value={controlledOpen}
            onChange={setControlledOpen}
          />
          <Popover
            open={controlledOpen}
            onOpenChange={setControlledOpen}
            trigger={<Box className="box p-2">Anchor</Box>}
            anchorOnly
            align="start"
            side="right"
            content={
              <Flex style={{ width: 200 }} direction="column" gap="2">
                <Text weight="bold">Controlled Popover</Text>
                <Text size="2">
                  This popover&apos;s open state is controlled by the switch
                  above. Click outside or press ESC won&apos;t close it.
                </Text>
              </Flex>
            }
            disableDismiss
          />
        </Flex>
      </Box>

      <Box>
        <Box mb="2">
          <Text weight="medium">Open on hover, in wrapped rows</Text>
        </Box>
        <Flex wrap="wrap" gap="1" style={{ maxWidth: 280 }}>
          {["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"].map(
            (tag) => (
              <Popover
                key={tag}
                openOnHover
                anchorOnly
                side="bottom"
                sideOffset={8}
                trigger={<Badge label={tag} variant="outline" />}
                content={
                  <Flex direction="column" gap="2" align="start">
                    <Text weight="bold">{tag}</Text>
                    <Button size="sm" variant="outline">
                      Something to click
                    </Button>
                  </Flex>
                }
              />
            ),
          )}
        </Flex>
      </Box>

      <Box>
        <Box mb="1">
          <Text weight="medium">Open on hover, after a delay</Text>
        </Box>
        <Box mb="2">
          <Text size="1" color="gray">
            hoverDelay keeps a pointer passing over dense rows from opening each
            one; it opens once the pointer rests (350ms here).
          </Text>
        </Box>
        <Flex direction="column" gap="1" style={{ maxWidth: 280 }}>
          {["production", "staging", "dev"].map((env) => (
            <Popover
              key={env}
              openOnHover
              hoverDelay={350}
              anchorOnly
              side="right"
              sideOffset={8}
              trigger={
                <span>
                  <Text>{env}</Text>
                </span>
              }
              content={<Text>Changed in this draft</Text>}
            />
          ))}
        </Flex>
      </Box>
    </Flex>
  );
}
