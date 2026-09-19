// Serialize related operations without blocking other guilds after a failure.
export function createQueue() {
  const pending = new Map();

  return function enqueue(key, operation) {
    const result = (pending.get(key) ?? Promise.resolve()).then(operation);
    const settled = result.catch(() => {}).finally(() => {
      if (pending.get(key) === settled) pending.delete(key);
    });
    pending.set(key, settled);
    return result;
  };
}
