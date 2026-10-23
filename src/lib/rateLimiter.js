/**
 * Minimal token bucket used to throttle socket events per connection.
 * `capacity` tokens are available at once and refill at `refillPerSec`.
 */
export function createTokenBucket({ capacity, refillPerSec, now = Date.now }) {
  let tokens = capacity;
  let last = now();
  return {
    take() {
      const current = now();
      tokens = Math.min(capacity, tokens + ((current - last) / 1000) * refillPerSec);
      last = current;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
