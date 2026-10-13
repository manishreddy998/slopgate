/**
 * Drop emoji and other pictographs from text copied out of a registry listing.
 * Letters, numbers, and ordinary punctuation stay.
 */
const PICTOGRAPH =
  /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u2600-\u27BF])(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u2600-\u27BF])(?:\uFE0F|\p{Emoji_Modifier})?)*/gu

const LEFTOVER_PICTOGRAPH = /[\u{1F3FB}-\u{1F3FF}\u200D\uFE0E\uFE0F\u20E3]/gu

export function stripPictographs(value: string): string {
  return value
    .replace(PICTOGRAPH, '')
    .replace(LEFTOVER_PICTOGRAPH, '')
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim()
}
