export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Math.min(Math.max(limit, 1), items.length)
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const index = cursor++
        if (index >= items.length) return
        results[index] = await fn(items[index]!, index)
      }
    }),
  )
  return results
}
