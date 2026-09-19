const MIN_TEXT_LENGTH = 200;
const MIN_REPEAT_COUNT = 5;
const MIN_COVERAGE = 0.5;
const BLOCK_LENGTHS = [20, 30, 50, 80, 120, 200] as const;

const DELIMITER_RE = /[\s。！？；;.!?，,、:："'`()[\]{}<>《》【】/\\|_-]+/g;

function isMeaningfulBlock(block: string): boolean {
  const compact = block.replace(DELIMITER_RE, '');
  if (compact.length < 12) return false;
  return new Set(Array.from(compact)).size >= 4;
}

function countExactPeriodRepeats(text: string, start: number, period: number): number {
  if (period <= 0 || start + period > text.length) return 0;

  const unit = text.slice(start, start + period);
  let count = 1;
  for (let pos = start + period; pos + period <= text.length; pos += period) {
    if (text.slice(pos, pos + period) !== unit) break;
    count += 1;
  }
  return count;
}

function countRepeatedBlocks(text: string): number {
  for (const blockLen of BLOCK_LENGTHS) {
    if (text.length < blockLen * MIN_REPEAT_COUNT) continue;

    const seen = new Map<string, {
      firstStart: number;
      lastStart: number;
      period: number | null;
      count: number;
    }>();
    for (let start = 0; start <= text.length - blockLen; start += 1) {
      const block = text.slice(start, start + blockLen);
      if (!isMeaningfulBlock(block)) continue;

      const prior = seen.get(block);
      if (!prior) {
        seen.set(block, {
          firstStart: start,
          lastStart: start,
          period: null,
          count: 1,
        });
        continue;
      }

      // Count non-overlapping occurrences only. This keeps degenerate runs
      // like "aaaaaaaa..." from inflating the repeat count at every offset.
      if (start < prior.lastStart + blockLen) continue;

      const nextPeriod = start - prior.lastStart;
      if (prior.period === nextPeriod) {
        prior.count += 1;
      } else {
        prior.firstStart = prior.lastStart;
        prior.period = nextPeriod;
        prior.count = 2;
      }
      prior.lastStart = start;

      if (
        prior.count >= MIN_REPEAT_COUNT &&
        prior.count * blockLen >= text.length * MIN_COVERAGE
      ) {
        return prior.count;
      }

      if (prior.count >= MIN_REPEAT_COUNT && prior.period !== null) {
        const exactCount = countExactPeriodRepeats(text, prior.firstStart, prior.period);
        if (
          exactCount >= MIN_REPEAT_COUNT &&
          exactCount * prior.period >= text.length * MIN_COVERAGE
        ) {
          return exactCount;
        }
      }
    }
  }

  return 0;
}

/**
 * Bug #123 / #269 guardrail — detect pathological content duplication that
 * almost certainly came from a third-party IME / voice-input glitch on macOS
 * WebView. The repeated span may start after non-repeated prefixes such as
 * pasted file references, so detection scans for dominant repeated blocks
 * anywhere in the payload instead of only checking the text prefix.
 *
 * Returns the approximate repeat count when suspicious repetition is found.
 */
export function detectExcessiveRepetition(text: string): number {
  if (text.length < MIN_TEXT_LENGTH) return 0;
  return countRepeatedBlocks(text);
}
