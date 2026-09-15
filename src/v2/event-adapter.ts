type V2EventRecord = Record<string, unknown> & {
  type?: unknown;
  event?: unknown;
  data?: unknown;
  properties?: Record<string, unknown>;
};

type V1Event = {
  type?: string;
  event?: string;
  properties?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function dataOf(ev: V2EventRecord): Record<string, unknown> | undefined {
  return asRecord(ev.data);
}

function sessionOf(ev: V2EventRecord): string | undefined {
  const data = dataOf(ev);
  if (data && typeof data.sessionID === "string") return data.sessionID;
  if (typeof ev.sessionID === "string") return ev.sessionID;
  if (ev.properties && typeof ev.properties.sessionID === "string") return ev.properties.sessionID;
  return undefined;
}

function statusType(ev: V2EventRecord): string | undefined {
  const status = dataOf(ev)?.status;
  const record = asRecord(status);
  return record && typeof record.type === "string" ? record.type : undefined;
}

function errorOf(ev: V2EventRecord): string | undefined {
  const data = dataOf(ev);
  if (!data) return undefined;
  const error = asRecord(data.error);
  if (error) {
    if (typeof error.message === "string" && error.message.trim()) return error.message;
    try {
      const json = JSON.stringify(error);
      return json && json.length > 0 ? json : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof data.error === "string" && data.error.trim()) return data.error;
  return undefined;
}

function v1(type: string, properties: Record<string, unknown>): V1Event {
  return { type, properties };
}

function rawEvent(ev: V2EventRecord): V1Event {
  return ev as unknown as V1Event;
}

export function mapV2EventToV1(event: unknown): V1Event[] {
  const rec = asRecord(event);
  if (!rec) return [{ event: "session.status", properties: {} }];
  const ev = rec as V2EventRecord;
  const type = typeof ev.type === "string" ? ev.type : typeof ev.event === "string" ? ev.event : "";
  const sessionID = sessionOf(ev);
  const props = sessionID ? { sessionID } : {};

  switch (type) {
    case "session.execution.started":
      return [rawEvent(ev), v1("session.status", { ...props, status: "busy" })];
    case "session.execution.succeeded":
      return [rawEvent(ev), v1("session.idle", props)];
    case "session.idle":
      return [rawEvent(ev), v1("session.status", { ...props, status: "idle" })];
    case "session.execution.failed": {
      const error = errorOf(ev);
      if (error && sessionID) {
        return [rawEvent(ev), v1("session.error", { sessionID, error })];
      }
      return [rawEvent(ev), v1("session.idle", props)];
    }
    case "session.execution.interrupted":
      return [rawEvent(ev), v1("session.idle", props)];
    case "session.status": {
      const st = statusType(ev);
      if (st === "idle") return [rawEvent(ev), v1("session.idle", props)];
      if (st === "retry") {
        const retry = asRecord(dataOf(ev)?.status);
        const message = retry && typeof retry.message === "string" ? retry.message : undefined;
        const retryProps = sessionID && message ? { sessionID, error: message } : props;
        return [rawEvent(ev), v1("session.error", retryProps)];
      }
      return [rawEvent(ev)];
    }
    default:
      return [rawEvent(ev)];
  }
}