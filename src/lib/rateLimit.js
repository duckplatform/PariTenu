/** Limiteur à fenêtre fixe, en mémoire, par clé (IP). Suffisant pour une instance entre amis. */
export class RateLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  /** true si la requête passe. */
  take(key, now = Date.now()) {
    const entry = this.hits.get(key);
    if (!entry || now >= entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.#prune(now);
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }

  #prune(now) {
    for (const [k, v] of this.hits) if (now >= v.resetAt) this.hits.delete(k);
  }
}
