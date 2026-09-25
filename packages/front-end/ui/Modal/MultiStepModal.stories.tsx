import { Box, Flex, TextArea, TextField } from "@radix-ui/themes";
import { useState } from "react";
import Modal, { useModalContext } from "@/ui/Modal";
import Button from "../Button";
import Callout from "../Callout";
import Checkbox from "../Checkbox";
import ErrorDisplay from "../ErrorDisplay";
import Link from "../Link";
import Text from "../Text";
import MultiStepModal, { useMultiStepModal } from "./MultiStepModal";
import MultiStepModalStandard from "./Patterns/MultiStepModalStandard";

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Standard pattern: the common wizard.
// ---------------------------------------------------------------------------

function ReviewFields({
  name,
  hypothesis,
}: {
  name: string;
  hypothesis: string;
}) {
  // Step content can navigate through the hook, e.g. a "go back and edit" link.
  const { goToStep } = useMultiStepModal();
  return (
    <Flex direction="column" gap="3">
      <Callout status="info">
        Review the experiment before creating it.{" "}
        <Link onClick={() => goToStep(0)}>Edit overview</Link>
      </Callout>
      <Text>
        <strong>Name:</strong> {name || "—"}
      </Text>
      <Text>
        <strong>Hypothesis:</strong> {hypothesis || "—"}
      </Text>
    </Flex>
  );
}

function StandardExample() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [disableStickyBucketing, setDisableStickyBucketing] = useState(false);

  return (
    <>
      <MultiStepModalStandard
        open={open}
        close={() => setOpen(false)}
        header="New Experiment"
        size="lg"
        cta="Create"
        submit={() => wait(400)}
        trackingEventModalType=""
      >
        <MultiStepModal.Step
          label="Overview"
          nextEnabled={!!name.trim()}
          disabledMessage="Enter an experiment name to continue"
        >
          <Flex direction="column" gap="5">
            <Flex direction="column" gap="1">
              <Text weight="semibold">Experiment name</Text>
              <TextField.Root
                placeholder="e.g. Homepage CTA test"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Flex>
            <Flex direction="column" gap="1">
              <Text weight="semibold">Hypothesis</Text>
              <TextField.Root
                placeholder="If we change X, we expect Y because Z"
                value={hypothesis}
                onChange={(e) => setHypothesis(e.target.value)}
              />
            </Flex>
          </Flex>
        </MultiStepModal.Step>
        <MultiStepModal.Step
          label="Targeting"
          validate={async () => {
            if (!hypothesis.trim()) {
              throw new Error("Add a hypothesis on the Overview step");
            }
          }}
        >
          <Checkbox
            label="Disable Sticky Bucketing"
            value={disableStickyBucketing}
            setValue={setDisableStickyBucketing}
          />
        </MultiStepModal.Step>
        <MultiStepModal.Step label="Review">
          <ReviewFields name={name} hypothesis={hypothesis} />
        </MultiStepModal.Step>
      </MultiStepModalStandard>
      <Button onClick={() => setOpen(true)}>Standard wizard</Button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Composed: a non-standard wizard built from the primitives. Modeled on
// NewFactTableModal: a full-bleed SQL editor on a wider first page, a mid-flow
// fetch in onNext, a confirmation above the footer, a custom footer, and a
// Done page.
// ---------------------------------------------------------------------------

function SqlEditorStep({
  sql,
  setSql,
}: {
  sql: string;
  setSql: (sql: string) => void;
}) {
  // Without Modal.Body the step renders the shared error itself.
  const { error } = useModalContext();
  return (
    <Box mt="5" mr="7">
      {error ? <ErrorDisplay error={error} mb="3" /> : null}
      <TextArea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        style={{ height: 320, fontFamily: "var(--code-font-family)" }}
      />
    </Box>
  );
}

function ConfirmAboveFooter({
  confirmed,
  setConfirmed,
}: {
  confirmed: boolean;
  setConfirmed: (confirmed: boolean) => void;
}) {
  const { isLastStep, isDone } = useMultiStepModal();
  if (!isLastStep || isDone) return null;
  return (
    <Box mt="3" mr="7">
      <Callout status="warning">
        <Flex justify="between" align="center" gap="3">
          New Fact Tables are available to every Project immediately.
          <Checkbox label="Confirm" value={confirmed} setValue={setConfirmed} />
        </Flex>
      </Callout>
    </Box>
  );
}

function FactTableFooter() {
  const { isDone, close } = useMultiStepModal();
  return (
    <Modal.Footer justify="between">
      <MultiStepModal.Back />
      <Flex gap="3" align="center">
        {isDone ? (
          <>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
            <Button onClick={close}>View Fact Table</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <MultiStepModal.Next submitLabel="Create Fact Table" />
          </>
        )}
      </Flex>
    </Modal.Footer>
  );
}

function ComposedExample() {
  const [open, setOpen] = useState(false);
  const [sql, setSql] = useState("SELECT user_id, timestamp FROM events");
  const [columns, setColumns] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  return (
    <>
      <MultiStepModal.Root
        open={open}
        onOpenChange={setOpen}
        onSubmit={() => wait(400)}
        trackingEventModalType=""
      >
        <Modal.Header>
          <Modal.Title>New Fact Table</Modal.Title>
        </Modal.Header>
        <MultiStepModal.Stepper />

        <MultiStepModal.Step
          label="Write SQL"
          size="xl"
          validate={async () => {
            if (!/\bselect\b/i.test(sql)) {
              throw new Error("Enter a SELECT statement");
            }
          }}
          // A fetch that should run once, when leaving this page. In validate
          // it would re-run on every later Next.
          onNext={async () => {
            await wait(400);
            setColumns(["user_id", "timestamp"]);
          }}
        >
          <SqlEditorStep sql={sql} setSql={setSql} />
        </MultiStepModal.Step>

        <MultiStepModal.Step
          label="Configure"
          nextEnabled={!!name.trim() && confirmed}
          disabledMessage={
            name.trim() ? 'Check "Confirm" to create' : "Enter a name"
          }
        >
          <Modal.Body>
            <Flex direction="column" gap="4">
              <Text>
                Detected columns: <strong>{columns.join(", ")}</strong>.{" "}
                <EditSqlLink />
              </Text>
              <Flex direction="column" gap="1">
                <Text weight="semibold">Fact Table name</Text>
                <TextField.Root
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Flex>
            </Flex>
          </Modal.Body>
        </MultiStepModal.Step>

        <MultiStepModal.Done>
          <Modal.Body>
            <Callout status="success">
              <strong>{name}</strong> was created.
            </Callout>
          </Modal.Body>
        </MultiStepModal.Done>

        <ConfirmAboveFooter confirmed={confirmed} setConfirmed={setConfirmed} />
        <FactTableFooter />
      </MultiStepModal.Root>
      <Button onClick={() => setOpen(true)}>Composed wizard</Button>
    </>
  );
}

function EditSqlLink() {
  const { goToStep } = useMultiStepModal();
  return <Link onClick={() => goToStep(0)}>Edit SQL</Link>;
}

export default function MultiStepModalStories() {
  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="2">
        <Text weight="semibold">Standard pattern</Text>
        <Text>
          MultiStepModalStandard covers the common wizard: header, Stepper, a
          scrollable body per step, and the Back / Cancel / Next footer.
        </Text>
        <Box>
          <StandardExample />
        </Box>
      </Flex>
      <Flex direction="column" gap="2">
        <Text weight="semibold">Composed from primitives</Text>
        <Text>
          For non-standard layouts: a full-bleed editor on a wider page, a
          mid-flow fetch in onNext, a confirmation above the footer, a custom
          footer, and a Done page.
        </Text>
        <Box>
          <ComposedExample />
        </Box>
      </Flex>
    </Flex>
  );
}
