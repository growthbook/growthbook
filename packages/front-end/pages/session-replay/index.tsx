import React, { useEffect, useRef, useState } from "react";
import "rrweb-player/dist/style.css";
import type { eventWithTime } from "@rrweb/types";
import Player from "rrweb-player";
import Callout from "@/components/Radix/Callout";
import Field from "@/components/Forms/Field";

function canReplay(events: eventWithTime[]): boolean {
  if (events.length < 2) return false;
  const hasFullSnapshot = events.some((e) => e.type === 2); // EventType.FullSnapshot === 2
  const hasIncremental = events.some((e) => e.type === 3); // EventType.IncrementalSnapshot === 3
  return hasFullSnapshot && hasIncremental;
}

export default function SessionReplayPage() {
  const [error, setError] = useState<string | null>(null);

  const [eventsStr, setEventsStr] = useState<string>("");
  // const metadata = {};

  const playerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let events: null | eventWithTime[] = null;
    if (!eventsStr) {
      setError(null);
      return;
    }

    try {
      events = JSON.parse(eventsStr);
    } catch (e) {
      setError("Malformed replay events");
    }

    if (!events || !playerRef.current) return;

    if (!canReplay(events)) {
      setError("Not enough data to replay session.");
      return;
    }

    // Clean up existing player instance
    playerRef.current.innerHTML = "";
    setError(null);

    new Player({
      target: playerRef.current,
      props: {
        events,
        showController: true,
      },
    });
  }, [eventsStr]);

  return (
    <div className="pagecontents">
      <h1>Session Replay</h1>

      <div className="box mb-4">
        {error && <Callout status="warning">{error}</Callout>}
        <div ref={playerRef} />
      </div>

      <div className="box">
        <Field
          label="Events"
          textarea
          value={eventsStr}
          onChange={(e) => setEventsStr(e.target.value)}
        />
      </div>
    </div>
  );
}
