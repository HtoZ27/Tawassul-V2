

import { logger } from "../utils/logger.ts";

export interface StateTransition<S extends string> {
  from: S;
  to: S;
  guard?: () => boolean | Promise<boolean>;
  onEnter?: () => void | Promise<void>;
  onExit?: () => void | Promise<void>;
}

export class StateMachine<S extends string> {
  private _current: S;
  private _transitions = new Map<string, StateTransition<S>>();
  private _history: Array<{ from: S; to: S; timestamp: number }> = [];

  constructor(initial: S) {
    this._current = initial;
  }

  get current(): S {
    return this._current;
  }

  get history(): ReadonlyArray<{ from: S; to: S; timestamp: number }> {
    return this._history;
  }

  addTransition(t: StateTransition<S>): void {
    this._transitions.set(`${t.from}→${t.to}`, t);
  }

  canTransition(to: S): boolean {
    const key = `${this._current}→${to}`;
    return this._transitions.has(key);
  }

  async transition(to: S): Promise<boolean> {
    const key = `${this._current}→${to}`;
    const t = this._transitions.get(key);
    if (!t) {
      logger.warn(`[state-machine] Invalid transition: ${this._current} → ${to}`);
      return false;
    }
    if (t.guard) {
      const ok = await t.guard();
      if (!ok) {
        logger.warn(`[state-machine] Guard blocked: ${this._current} → ${to}`);
        return false;
      }
    }
    if (t.onExit) await t.onExit();
    const from = this._current;
    this._current = to;
    this._history.push({ from, to, timestamp: Date.now() });
    if (t.onEnter) await t.onEnter();
    return true;
  }

  reset(state: S): void {
    this._current = state;
    this._history = [];
  }
}
