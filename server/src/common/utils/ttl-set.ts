/**
 * A bounded, TTL-aware Set for tracking in-progress items.
 *
 * Prevents:
 * - Memory leaks from items stuck after failed cleanup
 * - Unbounded growth under sustained load
 *
 * Each entry auto-expires after `ttlMs` and the total size is capped.
 */
export class TtlSet {
  private readonly entries = new Map<string, number>(); // key → expiry timestamp

  constructor(
    private readonly maxSize: number = 1000,
    private readonly ttlMs: number = 60_000, // 60s default
  ) {}

  /**
   * Add an item. Returns false if it already exists (not expired).
   */
  add(key: string): boolean {
    this.purgeExpired();

    if (this.entries.has(key)) {
      return false; // Already being processed
    }

    // If at capacity, reject (caller should handle gracefully)
    if (this.entries.size >= this.maxSize) {
      return false;
    }

    this.entries.set(key, Date.now() + this.ttlMs);
    return true;
  }

  /**
   * Check if an item is currently tracked (and not expired).
   */
  has(key: string): boolean {
    const expiry = this.entries.get(key);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Remove an item (normal completion).
   */
  delete(key: string): void {
    this.entries.delete(key);
  }

  /**
   * Current number of tracked items.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Remove all expired entries.
   */
  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, expiry] of this.entries) {
      if (now > expiry) {
        this.entries.delete(key);
      }
    }
  }
}
