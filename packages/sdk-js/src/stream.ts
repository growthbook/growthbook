interface ScopedChannel {
  key: string;
  connection: EventSource;
  // eslint-disable-next-line
  callbacks: ((event: string, payload: any) => void)[];
}

export interface Settings {
  apiHost: string;
  // eslint-disable-next-line
  eventSource?: any;
}

export class StreamManager {
  private apiHost = "";
  // eslint-disable-next-line
  private eventSource: any;
  private scopedChannels: Map<string, ScopedChannel> = new Map();

  // eslint-disable-next-line
  public initialize({apiHost, eventSource}: Settings) {
    this.apiHost = apiHost;
    this.eventSource = eventSource || globalThis.EventSource || undefined;
  }

  // eslint-disable-next-line
  public startStream(key: string, callback: (event: string, payload: any) => void) {
    if (this.eventSource) {
      let scopedChannel = this.scopedChannels.get(key);
      if (!scopedChannel) {
        scopedChannel = this.createScopedChannel(key);
      }
      scopedChannel.callbacks.push(callback);
    }
  }

  private createScopedChannel(key: string): ScopedChannel {
    const url = `${this.apiHost}/sub/${key}`;
    const channel: ScopedChannel = {
      key,
      connection: new EventSource(url),
      callbacks: [],
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
