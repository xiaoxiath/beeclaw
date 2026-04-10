/**
 * A simple async mutex for protecting critical sections.
 * Ensures only one caller can hold the lock at a time.
 */
export class AsyncMutex {
  private _queue: Array<() => void> = [];
  private _locked = false;

  async acquire(): Promise<() => void> {
    if (!this._locked) {
      this._locked = true;
      return this._createRelease();
    }
    return new Promise<() => void>((resolve) => {
      this._queue.push(() => resolve(this._createRelease()));
    });
  }

  private _createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this._queue.length > 0) {
        const next = this._queue.shift()!;
        next();
      } else {
        this._locked = false;
      }
    };
  }

  get locked(): boolean {
    return this._locked;
  }
}
