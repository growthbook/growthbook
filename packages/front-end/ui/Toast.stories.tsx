import { Flex } from "@radix-ui/themes";
import { useState } from "react";
import Button from "./Button";
import Toast from "./Toast";

export default function ToastStories() {
  const [show, setShow] = useState(false);
  const [withAction, setWithAction] = useState(false);

  return (
    <Flex direction="row" gap="3">
      <Button
        onClick={() => {
          setWithAction(false);
          setShow(true);
        }}
      >
        Show toast
      </Button>
      <Button
        variant="soft"
        onClick={() => {
          setWithAction(true);
          setShow(true);
        }}
      >
        Show toast with action
      </Button>
      {show ? (
        <Toast
          status="warning"
          action={
            withAction
              ? { label: "Retry", onClick: () => setShow(false) }
              : undefined
          }
          onDismiss={() => setShow(false)}
        >
          Couldn&rsquo;t refresh the latest data.
        </Toast>
      ) : null}
    </Flex>
  );
}
