import { RepositoryKey } from "./featuresRepository";

interface ScopedChannel {
  key: RepositoryKey;
  connection: EventSource;
  // eslint-disable-next-line
  callbacks: Map<string, (event: string, payload: any) => void>;
}

export class StreamManager {
  private initialized = false;
  // eslint-disable-next-line
  private eventSource: typeof EventSource | undefined;
  private scopedChannels: Map<string, ScopedChannel> = new Map();

  // eslint-disable-next-line
  public initialize(eventSource?: typeof EventSource) {
    if (this.initialized) return;
    this.initialized = true;
    this.eventSource = eventSource || globalThis.EventSource || undefined;
  }

  public startStream(
    key: RepositoryKey,
    sdkUid: string,
    // eslint-disable-next-line
    callback: (event: string, payload: any) => void
  ) {
    if (this.eventSource) {
      let scopedChannel = this.scopedChannels.get(key);
      if (!scopedChannel) {
        scopedChannel = this.createScopedChannel(key);
      }
      if (scopedChannel) {
        scopedChannel.callbacks.set(sdkUid, callback);
      }
    }
  }

  private createScopedChannel(key: RepositoryKey): ScopedChannel | undefined {
    if (!this.eventSource) {
      return undefined;
    }
    const [apiHost, clientKey] = key.split("||");
    const url = `${apiHost}/sub/${clientKey}`;
    const channel: ScopedChannel = {
      key,
      connection: new this.eventSource(url),
      callbacks: new Map(),
    };
    this.scopedChannels.set(key, channel);

    channel.connection.addEventListener("features", (event: MessageEvent) => {
      try {
        const json = JSON.parse(event.data);
        channel.callbacks.forEach((cb) => cb("features", json));
      } catch (e) {
        console.error("Failed to parse features from SSE", e);
      }
    });
    return channel;
  }
}

const streamManager = new StreamManager();
export default streamManager;
