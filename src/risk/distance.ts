/** Count letter changes. Swapping two side-by-side letters counts as one change. If the distance is above max, return max + 1. */
export function damerau(left: string, right: string, max = 2): number {
  if (left === right) return 0
  const aLen = left.length
  const bLen = right.length
  if (Math.abs(aLen - bLen) > max) return max + 1
  if (aLen === 0) return bLen > max ? max + 1 : bLen
  if (bLen === 0) return aLen > max ? max + 1 : aLen

  let previousPrevious = new Array<number>(bLen + 1).fill(0)
  let previous = new Array<number>(bLen + 1)
  for (let column = 0; column <= bLen; column++) previous[column] = column

  for (let row = 1; row <= aLen; row++) {
    const current = new Array<number>(bLen + 1)
    current[0] = row
    let rowMin = current[0]
    for (let column = 1; column <= bLen; column++) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      let value = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + cost,
      )
      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        value = Math.min(value, (previousPrevious[column - 2] ?? 0) + 1)
      }
      current[column] = value
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    previousPrevious = previous
    previous = current
  }
  const distance = previous[bLen] ?? max + 1
  return distance > max ? max + 1 : distance
}

export function homoglyphKey(value: string): string {
  return value
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/3/g, 'e')
    .replace(/5/g, 's')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
}

export function separatorKey(value: string): string {
  return value.replace(/[-_.]/g, '')
}

export function collapseRepeats(value: string): string {
  return value.replace(/(.)\1+/g, '$1')
}

export function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index++
  return index
}
