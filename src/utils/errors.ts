export class TawassulError extends Error {
  override name: string = "TawassulError";
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export class ConfigError extends TawassulError {
  override name: string = "ConfigError";
  constructor(message: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message, "CONFIG_ERROR", details, options);
  }
}

export class TimeoutError extends TawassulError {
  override name: string = "TimeoutError";
  constructor(message: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message, "TIMEOUT", details, options);
  }
}

export class PermissionError extends TawassulError {
  override name: string = "PermissionError";
  constructor(message: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message, "PERMISSION_DENIED", details, options);
  }
}

export class StateError extends TawassulError {
  override name: string = "StateError";
  constructor(message: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message, "STATE_ERROR", details, options);
  }
}

export class RollbackError extends TawassulError {
  override name: string = "RollbackError";
  constructor(message: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message, "ROLLBACK_FAILED", details, options);
  }
}
