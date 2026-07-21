import { Box, Flex, TextField } from "@radix-ui/themes";
import { CSSProperties, useState } from "react";
import Modal, { Size } from "@/ui/Modal";
import Button from "../Button";
import { Select, SelectItem } from "../Select";
import Text from "../Text";
import Checkbox from "../Checkbox";
import ModalForm, { useModalForm } from "./ModalForm";

function SubmitButton() {
  const { loading } = useModalForm();
  return (
    <Button type="submit" loading={loading}>
      Save
    </Button>
  );
}

// A table wider than the modal. It proves horizontal overflow is handled by the
// child itself (its own overflow-x: auto), and never spills into the modal body,
// which is vertical-scroll only.
function WideTable() {
  const columns = Array.from({ length: 12 }, (_, i) => `Metric ${i + 1}`);
  const rows = Array.from({ length: 4 }, (_, r) =>
    columns.map((_, c) => `R${r + 1}·C${c + 1}`),
  );
  const cellStyle: CSSProperties = {
    border: "1px solid var(--gray-a5)",
    padding: "8px 12px",
    whiteSpace: "nowrap",
    textAlign: "left",
  };
  return (
    <Box
      style={{
        overflowX: "auto",
        maxWidth: "100%",
        border: "1px solid var(--gray-a5)",
        borderRadius: "var(--radius-2)",
      }}
    >
      <table
        style={{
          borderCollapse: "collapse",
          minWidth: "1000px",
          fontSize: "var(--font-size-1)",
        }}
      >
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                style={{
                  ...cellStyle,
                  fontWeight: "bold",
                }}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r}>
              {cells.map((cell, c) => (
                <td key={c} style={cellStyle}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

export default function ModalStories() {
  const [size, setSize] = useState<Size | null>(null);
  const [scrolling, setScrolling] = useState(false);
  const [environment, setEnvironment] = useState("production");
  const [disableStickyBucketing, setDisableStickyBucketing] = useState(false);
  const openModal = (nextSize: Size, nextScrolling: boolean) => {
    setSize(nextSize);
    setScrolling(nextScrolling);
  };
  return (
    <>
      <Modal.Root
        open={!!size}
        onOpenChange={(open) => {
          if (!open) setSize(null);
        }}
        size={size ?? "md"}
        trackingEventModalType="test-modal"
      >
        <ModalForm
          onSubmit={() => {
            throw new Error("This is a test error");
          }}
        >
          <Modal.Header>
            <Modal.Title>GrowthBook Modal</Modal.Title>
            <Box width="140px">
              <Select value={environment} setValue={setEnvironment} size="1">
                <SelectItem value="production">Production</SelectItem>
                <SelectItem value="staging">Staging</SelectItem>
                <SelectItem value="development">Development</SelectItem>
              </Select>
            </Box>
          </Modal.Header>
          <Modal.Description>
            {`This is a ${size === "md" ? "medium" : "large"} example modal`}
          </Modal.Description>
          <Modal.Body>
            <Flex direction="column" gap="5">
              <Flex direction="column" gap="1">
                <Text weight="semibold">Experiment name</Text>
                <TextField.Root placeholder="e.g. Homepage CTA test" />
              </Flex>
              <Flex direction="column" gap="1">
                <Text weight="semibold">Hypothesis</Text>
                <TextField.Root placeholder="If we change X, we expect Y because Z" />
              </Flex>
              <Checkbox
                label="Disable Sticky Bucketing"
                value={disableStickyBucketing}
                setValue={setDisableStickyBucketing}
              />
              {scrolling && (
                <>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <Flex key={i} direction="column" gap="1">
                      <Text weight="semibold">{`Additional field ${i + 1}`}</Text>
                      <TextField.Root placeholder="Extra content to demonstrate the scrollbar" />
                    </Flex>
                  ))}
                  <Flex direction="column" gap="1">
                    <Text weight="semibold">
                      Wide table (scrolls horizontally on its own)
                    </Text>
                    <WideTable />
                  </Flex>
                </>
              )}
            </Flex>
          </Modal.Body>
          <Modal.Footer>
            <Modal.Close>
              <Button variant="ghost" onClick={() => setSize(null)}>
                Cancel
              </Button>
            </Modal.Close>
            <SubmitButton />
          </Modal.Footer>
        </ModalForm>
      </Modal.Root>

      <Flex direction="row" gap="3" wrap="wrap">
        <Button onClick={() => openModal("md", false)}>Medium Modal</Button>
        <Button onClick={() => openModal("lg", false)}>Large Modal</Button>
        <Button onClick={() => openModal("md", true)}>
          Medium Modal (scrolling)
        </Button>
        <Button onClick={() => openModal("lg", true)}>
          Large Modal (scrolling)
        </Button>
      </Flex>
    </>
  );
}
