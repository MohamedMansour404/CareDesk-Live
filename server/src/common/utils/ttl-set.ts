/**
 * Bounded TTL set used to track in-flight items.
 */
export class TtlSet {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly maxSize: number = 1000,
    private readonly ttlMs: number = 60_000,
  ) {}

  /** Adds an item unless it already exists and is not expired. */
  add(key: string): boolean {
    this.purgeExpired();

    if (this.entries.has(key)) {
      return false;
    }

    if (this.entries.size >= this.maxSize) {
      return false;
    }

    this.entries.set(key, Date.now() + this.ttlMs);
    return true;
  }

  /** Returns true when the key exists and is not expired. */
  has(key: string): boolean {
    const expiry = this.entries.get(key);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  /** Removes an item. */
  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Current tracked size. */
  get size(): number {
    return this.entries.size;
  }

  /** Purges expired entries. */
  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, expiry] of this.entries) {
      if (now > expiry) {
        this.entries.delete(key);
      }
    }
  }
}
