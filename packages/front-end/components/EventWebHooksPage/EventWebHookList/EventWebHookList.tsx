import React, { FC, PropsWithChildren, useCallback, useState } from "react";
import { EventWebHookInterface } from "../../../../back-end/types/event-webhook";
import { EventWebHookListItem } from "./EventWebHookListItem/EventWebHookListItem";
import { EventWebHookEditParams, EventWebHookModalMode } from "../utils";
import { EventWebHookAddEditModal } from "../EventWebHookAddEditModal/EventWebHookAddEditModal";

type EventWebHookListProps = {
  onModalOpen: () => void;
  onModalClose: () => void;
  isModalOpen: boolean;
  modalMode: EventWebHookModalMode | null;
  onAdd: (data: EventWebHookEditParams) => void;
  onEdit: (data: EventWebHookEditParams) => void;
  eventWebHooks: EventWebHookInterface[];
};

export const EventWebHookList: FC<EventWebHookListProps> = ({
  eventWebHooks,
  isModalOpen,
  modalMode,
  onEdit,
  onAdd,
  onModalClose,
  onModalOpen,
}) => {
  return (
    <div>
      {isModalOpen && modalMode ? (
        <EventWebHookAddEditModal
          isOpen={isModalOpen}
          onClose={onModalClose}
          onSubmit={modalMode.mode === "edit" ? onEdit : onAdd}
          mode={modalMode}
        />
      ) : null}

      {eventWebHooks.length === 0 ? (
        <EventWebHooksEmptyState>
          <button className="btn btn-primary" onClick={onModalOpen}>
            {/*<FaBolt /> */}
            Create an Event Webhook
          </button>
        </EventWebHooksEmptyState>
      ) : (
        <div>
          {eventWebHooks.map((eventWebHook) => (
            <div key={eventWebHook.id} className="mb-3">
              <EventWebHookListItem
                href={`/webhooks/${eventWebHook.id}`}
                eventWebHook={eventWebHook}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const EventWebHooksEmptyState: FC<PropsWithChildren> = ({ children }) => (
  <div className="row">
    <div className="col-xs-12 col-md-6 offset-md-3">
      <div className="card text-center p-3">
        When Event Webhooks are created, they will show up here.
        <div className="mt-4">{children}</div>
      </div>
    </div>
  </div>
);

export const EventWebHookListContainer = () => {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalMode, setModalMode] = useState<EventWebHookModalMode | null>(
    null
  );

  const handleAdd = useCallback((data: EventWebHookEditParams) => {
    console.log("handleAdd", data);
    // setModalMode({ mode: "create" });
  }, []);

  const handleEdit = useCallback((data: EventWebHookEditParams) => {
    console.log("handleEdit", data);
  }, []);

  return (
    <EventWebHookList
      isModalOpen={isModalOpen}
      onModalClose={() => setIsModalOpen(false)}
      onModalOpen={() => setIsModalOpen(true)}
      modalMode={modalMode}
      eventWebHooks={[]}
      onAdd={handleAdd}
      onEdit={handleEdit}
    />
  );
};
