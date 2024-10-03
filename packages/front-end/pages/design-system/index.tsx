import { Flex } from "@radix-ui/themes";
import { useState } from "react";
import HelperText from "@/components/Radix/HelperText";
import Checkbox from "@/components/Radix/Checkbox";
import Button, { Size } from "@/components/Radix/Button";
import SelectField from "@/components/Forms/SelectField";

export default function DesignSystemPage() {
  const [checked, setChecked] = useState(false);
  const [size, setSize] = useState<Size>("md");

  return (
    <div className="pagecontents container-fluid">
      <h1>GrowthBook Design System</h1>
      <p>
        This page is a work in progress to document the GrowthBook design
        system.
      </p>

      <h2>Components</h2>

      <div className="appbox p-3">
        <h3>Button</h3>
        <div className="mb-2 w-200px">
          <SelectField
            value={size}
            options={[
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
          <Button size={size} aria-label="Aria">
            Aria
          </Button>
          <Button size={size} theme="danger">
            Danger
          </Button>
          <Button size={size} variant="soft">
            Primary soft
          </Button>
          <Button size={size} theme="danger" variant="outline">
            Danger outline
          </Button>
          <Button size={size} variant="ghost">
            Primary ghost
          </Button>
        </Flex>
        <Flex direction="row" gap="3" className="my-3">
          <Button size={size} loading disabled>
            Primary loading
          </Button>
          <Button size={size} loading theme="danger" disabled>
            Danger loading
          </Button>
          <Button size={size} loading disabled>
            PD loading
          </Button>
          <Button size={size} loading variant="ghost">
            PG loading
          </Button>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>HelperText</h3>
        <Flex direction="column" gap="3">
          <HelperText status="info">This is an info message</HelperText>
          <HelperText status="warning">This is a warning message</HelperText>
          <HelperText status="error">This is an error message</HelperText>
          <HelperText status="success">This is a success message</HelperText>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Checkbox</h3>
        <Flex direction="column" gap="3">
          <Checkbox
            label="Checkbox Label"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
          />
          <Checkbox
            label="Checkbox With Description"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
            description="This is a description"
          />
          <Checkbox
            label="Checkbox With Warning (and description)"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
            description="This is a description"
            error="This is a warning message"
            errorLevel="warning"
          />
          <Checkbox
            label="Checkbox With Error"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
            error="This is an error message"
          />
          <Checkbox
            label="Disabled"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
            disabled
          />
        </Flex>
      </div>
    </div>
  );
}
DesignSystemPage.preAuth = true;
DesignSystemPage.preAuthTopNav = true;
