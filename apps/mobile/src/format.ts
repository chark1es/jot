const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Time for today, then Yesterday, a weekday within the week, and a date after that. */
export function formatListDate(ms: number, now: Date = new Date()): string {
  if (ms <= 0) {
    return '';
  }
  const date = new Date(ms);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatFullDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function displayTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length === 0 ? 'New note' : trimmed;
}

export function daysUntil(ms: number | null, now: number = Date.now()): number | null {
  if (ms === null) {
    return null;
  }
  return Math.max(0, Math.ceil((ms - now) / DAY_MS));
}
