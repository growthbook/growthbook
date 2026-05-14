import { useState, FC } from "react";
import {
  OrganizationInterface,
  OrganizationMessage,
} from "shared/types/organization";
import { canSuperAdminWrite } from "shared/validators";
import TextareaAutosize from "react-textarea-autosize";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { isCloud } from "@/services/env";
import Callout from "@/ui/Callout";

type MessageWithId = OrganizationMessage & { id: string };

function emptyMessage(): MessageWithId {
  return { id: crypto.randomUUID(), message: "", level: "info" };
}

const EditOrganizationMessages: FC<{
  organization: OrganizationInterface;
  onSaved: () => void;
  close: () => void;
}> = ({ organization, onSaved, close }) => {
  // When there are no saved messages yet, seed the form with one blank row so
  // the user can start typing immediately.
  const [messages, setMessages] = useState<MessageWithId[]>(() => {
    const existing = (organization.messages || []).map((m) => ({
      ...m,
      id: crypto.randomUUID(),
    }));
    return existing.length ? existing : [emptyMessage()];
  });

  const { apiCall } = useAuth();
  const { superAdmin } = useUser();
  const canWrite = canSuperAdminWrite(superAdmin);

  const handleSubmit = async () => {
    await apiCall<{
      status: number;
      message?: string;
    }>("/admin/organization", {
      method: "PUT",
      body: JSON.stringify({
        orgId: organization.id,
        messages: messages.map(({ id: _id, ...m }) => m),
      }),
    });
    onSaved();
  };

  const addMessage = () => {
    setMessages([...messages, emptyMessage()]);
  };

  const updateMessage = (
    id: string,
    field: keyof OrganizationMessage,
    value: string,
  ) => {
    setMessages(
      messages.map((m) => (m.id === id ? { ...m, [field]: value } : m)),
    );
  };

  const removeMessage = (id: string) => {
    setMessages(messages.filter((m) => m.id !== id));
  };

  if (!isCloud()) {
    return null;
  }

  return (
    <ModalStandard
      open={true}
      header={canWrite ? "Edit organization messages" : "Organization messages"}
      cta={canWrite ? "Save" : "Close"}
      submit={canWrite ? handleSubmit : undefined}
      close={close}
      trackingEventModalType=""
      size="lg"
    >
      {!canWrite && (
        <Callout status="info" mb="3">
          Read-only super admins cannot edit organization messages.
        </Callout>
      )}
      <div className="d-flex justify-content-between align-items-center mb-1">
        <span className="font-weight-bold mb-0">Banners for this org</span>
        {canWrite && (
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            onClick={addMessage}
          >
            + Add message
          </button>
        )}
      </div>
      <div className="text-muted small mb-3">
        Shown to all users in this organization. Markdown supported.
      </div>
      {messages.map((msg) => (
        <Flex gap="2" align="start" key={msg.id}>
          <TextareaAutosize
            className="form-control form-control-sm flex-grow-1"
            style={{ minWidth: 160, resize: "none" }}
            minRows={1}
            placeholder="Message (Markdown supported)"
            value={msg.message}
            disabled={!canWrite}
            onChange={(e) => updateMessage(msg.id, "message", e.target.value)}
          />
          <select
            className="form-control form-control-sm"
            style={{ width: 110, flexShrink: 0 }}
            value={msg.level}
            disabled={!canWrite}
            onChange={(e) =>
              updateMessage(
                msg.id,
                "level",
                e.target.value as OrganizationMessage["level"],
              )
            }
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="danger">Danger</option>
          </select>
          {canWrite && (
            <button
              type="button"
              className="btn btn-sm btn-outline-danger"
              style={{ flexShrink: 0 }}
              onClick={() => removeMessage(msg.id)}
            >
              &times;
            </button>
          )}
        </Flex>
      ))}
    </ModalStandard>
  );
};

export default EditOrganizationMessages;
