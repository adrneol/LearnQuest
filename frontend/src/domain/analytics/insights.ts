// Cautious, rule-based insights generated ONLY from recorded values.
// Each insight states its inputs; insufficient data yields a "not enough data"
// note instead of a fabricated conclusion. Never claims comprehension.

export interface InsightInput {
  thisWeekContentSec: number;
  lastWeekContentSec: number;
  thisWeekFocusSec: number;
  lastWeekFocusSec: number;
  sessionsThisWeek: number;
  targetSessionMin: number;
  avgSessionMin: number | null;
  largestRemainingModule: { name: string; remainingSec: number | null; remainingCount: number } | null;
  efficiencySamples: number;
}

export interface Insight {
  kind: 'info' | 'warn' | 'good';
  text: string;
}

export function buildInsights(i: InsightInput): Insight[] {
  const out: Insight[] = [];
  if (i.sessionsThisWeek < 2 && i.thisWeekFocusSec === 0 && i.thisWeekContentSec === 0) {
    out.push({ kind: 'info', text: 'No sessions recorded this week yet — even a 10-minute minimum-viable session keeps the streak logic honest.' });
    return out;
  }
  if (i.thisWeekContentSec > i.lastWeekContentSec && i.lastWeekContentSec > 0) {
    out.push({ kind: 'good', text: `You covered more video content this week than last week.` });
  } else if (i.lastWeekContentSec > 0 && i.thisWeekContentSec < i.lastWeekContentSec) {
    out.push({ kind: 'info', text: `Content coverage is lower than last week. Check whether recent time went into practice/notes (efficiency view shows the split).` });
  }
  if (i.thisWeekFocusSec > i.lastWeekFocusSec && i.thisWeekContentSec <= i.lastWeekContentSec && i.lastWeekFocusSec > 0) {
    out.push({ kind: 'info', text: `Recorded study time increased while unique content coverage stayed similar — likely deeper practice, rewatching, or debugging.` });
  }
  if (i.avgSessionMin !== null && i.avgSessionMin < i.targetSessionMin * 0.6) {
    out.push({ kind: 'warn', text: `Recent sessions average ${Math.round(i.avgSessionMin)} min vs a ${i.targetSessionMin}-min target. Consider a shorter target rather than skipping days.` });
  }
  if (i.largestRemainingModule && (i.largestRemainingModule.remainingCount > 0)) {
    out.push({ kind: 'warn', text: `"${i.largestRemainingModule.name}" has the largest remaining workload (${i.largestRemainingModule.remainingCount} videos left).` });
  }
  if (i.efficiencySamples < 3) {
    out.push({ kind: 'info', text: `Not enough sessions (${i.efficiencySamples}) to compare efficiency reliably — trends unlock at 3+ sessions per window.` });
  }
  if (out.length === 0) {
    out.push({ kind: 'good', text: 'Steady week — coverage and focus are tracking together.' });
  }
  return out;
}
