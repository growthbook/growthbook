import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { BsArrowRepeat } from "react-icons/bs";
import { PiCaretDownFill } from "react-icons/pi";
import { FaDownload } from "react-icons/fa";
import SelectField from "@/components/Forms/SelectField";
import HelperText from "@/ui/HelperText";
import Button, { Size } from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import SplitButton from "@/ui/SplitButton";

export default function ButtonStories() {
  const [size, setSize] = useState<Size>("md");
  const [buttonLoadError, setButtonLoadError] = useState<string | null>(null);

  return (
    <div>
      <div className="mb-2 w-200px">
        <SelectField
          value={size}
          options={[
            { label: "extra sm", value: "xs" },
            { label: "small", value: "sm" },
            { label: "medium", value: "md" },
            { label: "large", value: "lg" },
          ]}
          sort={false}
          onChange={(v: Size) => setSize(v)}
        />
      </div>
      <Flex direction="row" gap="3" className="my-3">
        <Button size={size}>Primary</Button>
        <Button size={size} aria-label="Aria" variant="outline">
          Aria
        </Button>
        <Button size={size} color="red">
          Danger
        </Button>
        <Button size={size} variant="soft">
          Primary soft
        </Button>
        <Button size={size} color="red" variant="outline">
          Danger outline
        </Button>
        <Button size={size} variant="ghost">
          Primary ghost
        </Button>
      </Flex>
      <Flex direction="row" gap="3" className="my-3">
        <Button size={size} icon={<FaDownload />}>
          Download
        </Button>
        <Button
          size={size}
          icon={<BsArrowRepeat />}
          onClick={async () =>
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }
        >
          Click to load...
        </Button>
        <div>
          <Button
            size={size}
            color="red"
            variant="outline"
            mb="2"
            icon={<BsArrowRepeat />}
            onClick={async () =>
              await new Promise<void>((resolve, reject) =>
                setTimeout(() => {
                  if (Math.random() < 0.5) {
                    resolve();
                  } else {
                    reject(new Error("Something went wrong."));
                  }
                }, 1000),
              )
            }
            setError={setButtonLoadError}
          >
            This might fail...
          </Button>
          {!!buttonLoadError && (
            <HelperText status="error">{buttonLoadError}</HelperText>
          )}
        </div>
      </Flex>

      <b>LinkButton</b>
      <Flex direction="row" gap="3" className="my-3">
        <LinkButton size={size} variant="ghost" href="https://growthbook.io">
          A button link
        </LinkButton>
        <LinkButton
          size={size}
          disabled
          variant="ghost"
          color="red"
          href="https://growthbook.io"
        >
          A disabled link
        </LinkButton>
      </Flex>

      <b>SplitButton</b>
      <Flex direction="row" gap="3" className="my-3">
        <SplitButton
          menu={
            <DropdownMenu
              trigger={
                <Button size={size}>
                  <PiCaretDownFill />
                </Button>
              }
              menuPlacement="end"
            >
              <DropdownMenuItem>Create New Experiment</DropdownMenuItem>
              <DropdownMenuItem>Import Existing Experiment</DropdownMenuItem>
            </DropdownMenu>
          }
        >
          <Button size={size} icon={<FaDownload />}>
            Download
          </Button>
        </SplitButton>
      </Flex>
    </div>
  );
}
