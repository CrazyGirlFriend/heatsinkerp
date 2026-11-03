// These links identify material movement, independently of each team's batch number.
export function traceBatch(links, batchId) {
  const ids = new Set([batchId]);
  const related = new Set();
  for (const [source, target] of [
    ["from", "to"],
    ["to", "from"],
  ]) {
    const visited = new Set([batchId]);
    const pending = [batchId];
    while (pending.length) {
      const id = pending.pop();
      for (const link of links) {
        if (link[source] !== id) continue;
        related.add(link);
        ids.add(link[target]);
        if (!visited.has(link[target])) {
          visited.add(link[target]);
          pending.push(link[target]);
        }
      }
    }
  }
  return { ids, links: [...related] };
}
