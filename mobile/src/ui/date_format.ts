/** Display helpers for ISO dates (YYYY-MM-DD), formatted without time-zone shifts. */
const longFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
const shortFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

function noonUtc(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

export function formatLongDate(date: string): string {
  return longFormatter.format(noonUtc(date));
}

export function formatShortDate(date: string): string {
  return shortFormatter.format(noonUtc(date));
}

export function formatLocalTime(isoInstant: string): string {
  return new Date(isoInstant).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
