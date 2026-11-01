/** Test-only SSE reader. It never mocks the transport; it reads a real HTTP stream. */
export interface SseFrame {
  event: string | null;
  data: string | null;
  comment: string | null;
  raw: string;
}

export class SseClient {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private done = false;
  private waiters: Array<() => void> = [];

  constructor(
    private readonly controller: AbortController,
    response: Response,
  ) {
    if (!response.body) throw new Error('SSE response has no body.');
    this.reader = response.body.getReader();
    void this.pump();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  private async pump(): Promise<void> {
    try {
      while (true) {
        const result = await this.reader.read();
        if (result.done) break;
        this.buffer += this.decoder.decode(result.value, { stream: true });
        this.wake();
      }
    } catch {
      // Tests close streams with AbortController.
    } finally {
      this.done = true;
      this.wake();
    }
  }

  private waitForChange(timeoutMs: number): Promise<void> {
    if (this.done || this.buffer.includes('\n\n')) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      const unref = (timer as { unref?: () => void }).unref;
      if (typeof unref === 'function') unref.call(timer);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async readFrame(timeoutMs: number): Promise<SseFrame | null> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const lf = this.buffer.indexOf('\n\n');
      const crlf = this.buffer.indexOf('\r\n\r\n');
      const boundary = lf >= 0 && (crlf < 0 || lf < crlf) ? lf : crlf;
      if (boundary >= 0) {
        const length = boundary === crlf ? 4 : 2;
        const raw = this.buffer.slice(0, boundary);
        this.buffer = this.buffer.slice(boundary + length);
        const lines = raw.split(/\r?\n/);
        let event: string | null = null;
        let data: string | null = null;
        const comments: string[] = [];
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data = line.slice(5).trim();
          else if (line.startsWith(':')) comments.push(line.slice(1).trim());
        }
        return { event, data, comment: comments.join('\n') || null, raw };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      if (this.done) return null;
      await this.waitForChange(remaining);
    }
  }

  async waitForConnected(timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const frame = await this.readFrame(deadline - Date.now());
      if (!frame) break;
      if (frame.event) throw new Error(`Stream failed before readiness: ${frame.raw}`);
      if (frame.comment === 'connected') return;
    }
    throw new Error('SSE stream did not become ready.');
  }

  async nextEvent(timeoutMs = 2_000): Promise<SseFrame | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const frame = await this.readFrame(deadline - Date.now());
      if (!frame) return null;
      if (frame.event) return frame;
    }
    return null;
  }

  close(): void {
    this.controller.abort();
    void this.reader.cancel().catch(() => undefined);
  }
}

/** Open a real authenticated stream and wait until the server confirms subscription. */
export async function openSseStream(origin: string, cookie: string): Promise<SseClient> {
  const controller = new AbortController();
  const response = await fetch(`${origin}/api/auth/events`, {
    headers: { Cookie: cookie },
    signal: controller.signal,
  });
  if (response.status !== 200) {
    controller.abort();
    throw new Error(`SSE connection failed with status ${response.status}.`);
  }
  if (!String(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    controller.abort();
    throw new Error('SSE connection did not return text/event-stream.');
  }
  const client = new SseClient(controller, response);
  await client.waitForConnected();
  return client;
}

export function expectInvalidation(frame: SseFrame | null, reason: string): void {
  if (!frame) throw new Error('Expected an invalidation event but the stream produced none.');
  if (frame.event !== 'auth-invalidated') {
    throw new Error(`Expected auth-invalidated, received ${frame.event ?? frame.raw}.`);
  }
  const parsed = JSON.parse(frame.data ?? 'null') as unknown;
  const expected = { type: 'auth-invalidated', reason };
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected SSE payload: ${frame.data}`);
  }
}
