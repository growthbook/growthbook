import React, { useEffect, useRef, useState } from "react";
import "rrweb-player/dist/style.css";
import type { eventWithTime } from "@rrweb/types";
import Player from "rrweb-player";
import Callout from "@/components/Radix/Callout";
import Field from "@/components/Forms/Field";
import { toast, Toaster } from "sonner";

function canReplay(events: eventWithTime[]): boolean {
  if (events.length < 2) return false;
  const hasFullSnapshot = events.some((e) => e.type === 2);
  const hasIncremental = events.some((e) => e.type === 3);
  return hasFullSnapshot && hasIncremental;
}

function formatCustomEvent(data: any) {
  if (data.tag === "feature-flag") {
    return `Feature Flag: ${data.payload.id} → ${JSON.stringify(data.payload.value)}`;
  } else if (data.tag === "experiment") {
    return `Experiment: ${data.payload.id} → variation ${data.payload.variation}`;
  }
  return "Custom Event";
}

export default function SessionReplayPage() {
  const [error, setError] = useState<string | null>(null);
  const [eventsStr, setEventsStr] = useState<string>("");
  const [firstEvent, setFirstEvent] = useState<null | eventWithTime>(null);
  const [customEvents, setCustomEvents] = useState<any[]>([]);

  const playerRef = useRef<HTMLDivElement>(null);
  const playerInstance = useRef<any>(null);

  useEffect(() => {
    return () => {
      // Cleanup: remove player and listener if unmounting
      if (playerInstance.current) {
        playerInstance?.current?.removeEventListener?.("custom-event", onCustomEvent);
      }
    };
  }, []);

  const onCustomEvent = (e: any) => {
    const { tag, payload } = e.data;
    toast(formatCustomEvent({ tag, payload }));
  };

  const jumpToEvent = (timestamp: number) => {
    const offset = firstEvent?.timestamp || 0;
    if (playerInstance.current) {
      playerInstance.current.goto(timestamp - offset);
    }
  };

  useEffect(() => {
    let events: null | eventWithTime[] = null;

    if (!eventsStr) {
      setError(null);
      setFirstEvent(null);
      return;
    }

    try {
      events = JSON.parse(eventsStr);
    } catch (e) {
      setError("Malformed replay events");
      setFirstEvent(null);
      return;
    }

    if (!events || !playerRef.current) {
      setFirstEvent(null);
      return;
    }

    if (!canReplay(events)) {
      setError("Not enough data to replay session.");
      setFirstEvent(null);
      return;
    }

    setError(null);
    setFirstEvent(events[0]);

    // Clear previous player instance if any
    if (playerInstance.current) {
      playerInstance?.current?.removeEventListener?.("custom-event", onCustomEvent);
      playerInstance.current = null;
    }
    playerRef.current.innerHTML = "";

    const player = new Player({
      target: playerRef.current,
      props: {
        events,
        showController: true,
      },
    });

    playerInstance.current = player;
    player.addEventListener("custom-event", onCustomEvent);

    // Collect custom events
    const customEventsList = events
      .filter((e) => e.type === 5)
      .map((e) => ({
        timestamp: e.timestamp,
        formattedMessage: formatCustomEvent(e.data),
      }));

    setCustomEvents(customEventsList);
  }, [eventsStr]);

  return (
    <div className="pagecontents">
      <h1>Session Replay</h1>
      {error && <Callout status="warning">{error}</Callout>}

      <div className="d-flex">
        <div className="box d-flex justify-content-center mb-4 flex-grow-1">
          <div ref={playerRef} />
        </div>

        <div className="box p-4 ml-4" style={{ minWidth: "300px", overflowY: "auto", height: "500px" }}>
          <h3>Evaluations</h3>
          <ul className="list-unstyled">
            {customEvents.map((event, index) => (
              <li
                key={index}
                className="cursor-pointer mb-2 p-2 border rounded"
                onClick={() => jumpToEvent(event.timestamp)}
                style={{ backgroundColor: "#f0f0f0", color: "#333", maxHeight: 200, overflowY: "auto" }}
              >
                <strong>{new Date(event.timestamp).toLocaleTimeString()}</strong>: {event.formattedMessage}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="box p-4">
        <Field
          label="Events"
          textarea
          value={eventsStr}
          onChange={(e) => setEventsStr(e.target.value)}
        />
      </div>

      <Toaster richColors />
    </div>
  );
}
