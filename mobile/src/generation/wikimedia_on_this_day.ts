import { a5BundledId, a5WikimediaId, type A5Day, type A5Event } from '../content/content_types';
import type { SqlExecutor } from '../platform/sql_executor';
import type { FetchLike } from './anthropic_client';

/**
 * Optional A5 refill from Wikipedia's On this day feed (spec Section 6; decision G6): used
 * only for dates without a bundled entry. The feed text is Wikipedia's (CC BY-SA 4.0), so
 * the item carries an attribution line that the A5 screen shows.
 */
export const WIKIMEDIA_ATTRIBUTION = 'Text from Wikipedia’s “On this day” feed, CC BY-SA 4.0.';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function onThisDayUrl(dateKey: string): string {
  const [month, day] = dateKey.split('-');
  return `https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/${month}/${day}`;
}

interface FeedEvent {
  readonly text?: string;
  readonly year?: number;
  readonly pages?: readonly { readonly content_urls?: { readonly desktop?: { readonly page?: string } }; readonly titles?: { readonly normalized?: string } }[];
}

export function parseOnThisDayFeed(dateKey: string, body: unknown): A5Day | null {
  const selected = (body as { selected?: FeedEvent[] } | null)?.selected;
  if (!Array.isArray(selected)) return null;
  const [month, day] = dateKey.split('-').map(Number);
  const datePage = `https://en.wikipedia.org/wiki/${MONTHS[(month ?? 1) - 1]}_${day}`;
  const events: A5Event[] = selected
    .filter((event) => typeof event.text === 'string' && event.text.length >= 20 && Number.isInteger(event.year))
    .slice(0, 3)
    .map((event) => {
      const page = event.pages?.[0];
      return {
        year: event.year as number,
        category: 'history',
        summary: (event.text as string).trim(),
        source: { title: page?.titles?.normalized ? `${page.titles.normalized} - Wikipedia` : `${MONTHS[(month ?? 1) - 1]} ${day} - Wikipedia`, url: page?.content_urls?.desktop?.page ?? datePage },
      };
    });
  return events.length > 0 ? { date_key: dateKey, events, attribution: WIKIMEDIA_ATTRIBUTION } : null;
}

/** Fetches and stores the entry for a date unless a bundled or fetched entry already exists. */
export async function fetchOnThisDayIfMissing(
  executor: SqlExecutor,
  fetchImpl: FetchLike,
  dateKey: string,
  now: Date,
): Promise<'exists' | 'stored' | 'empty' | 'failed'> {
  const exists = executor.get('SELECT 1 AS present FROM content_item WHERE id IN (?, ?)', [a5BundledId(dateKey), a5WikimediaId(dateKey)]);
  if (exists) return 'exists';
  try {
    const response = await fetchImpl(onThisDayUrl(dateKey), {
      method: 'GET',
      headers: { accept: 'application/json', 'Api-User-Agent': 'MicroHabits/0.3 (personal iPhone app; github.com/darrenadixonpi/daily-micro-habits)' },
    });
    if (!response.ok) return 'failed';
    const parsed = parseOnThisDayFeed(dateKey, await response.json());
    if (!parsed) return 'empty';
    executor.run(
      "INSERT OR IGNORE INTO content_item (id, module, language, payload_json, source, status, imported_at) VALUES (?, 'A5', 'en', ?, 'wikimedia', 'unserved', ?)",
      [a5WikimediaId(dateKey), JSON.stringify(parsed), now.toISOString()],
    );
    return 'stored';
  } catch {
    return 'failed';
  }
}
