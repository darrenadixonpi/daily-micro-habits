import {
  buildBackupDocument,
  computeTableChecksums,
  parseExportText,
  restoreBackupDocument,
  verifyBackupDocument,
  type BackupDocument,
} from '../backup/backup_codec';
import { buildExportFiles } from '../backup/export_files';
import { BUNDLED_CONTENT, type BundledContentSet } from '../content/bundled_content';
import { bundledRows, importBundledContent } from '../content/content_import';
import { assignedItem, excludeContentItem } from '../content/content_repository';
import { assignDailyContent, selectionSettingsFrom, type SelectionSettings } from '../content/content_selection';
import { formulaToText } from '../content/formula_text';
import { computeDayStatus, recordDayStatus } from '../daily/day_status';
import { CURRENT_SCHEMA_VERSION } from '../db/database_schema';
import { runMigrations } from '../db/run_migrations';
import type { FetchLike } from '../generation/anthropic_client';
import { runOneRefill } from '../generation/generation_service';
import { validateA1Batch, validateA3Batch, validateA4Batch } from '../generation/generation_validation';
import { fetchOnThisDayIfMissing, parseOnThisDayFeed } from '../generation/wikimedia_on_this_day';
import { completeA1, sentenceUsesWord } from '../learning/a1_word';
import { answerRecall, markConceptRead, pendingRecall } from '../learning/a3_concept';
import { completeA4, matchPhrase } from '../learning/a4_phrase';
import { markA5Opened, saveA5EventCard } from '../learning/a5_on_this_day';
import { describeCard } from '../learning/card_faces';
import { a2State, reviewProgress, type ReviewDayContext } from '../learning/review_queue';
import { createNotificationText } from '../notifications/notification_text';
import type { SqlExecutor } from '../platform/sql_executor';
import { readAllSettings, writeSetting } from '../settings/settings_repository';
import { Rating, type AppScheduler } from '../srs/fsrs_scheduler';
import { previewIntervals, recordReview } from '../srs/review_service';
import { computeStats, median, spearman } from '../stats/adherence_metrics';
import { addDays, logicalDayBounds } from '../time/logical_day';
import { check, type DiagnosticCase } from './diagnostic_environment';
import { withScratch } from './diagnostic_cases_m2';
import { insertSampleRows } from './sample_data';

/**
 * Diagnostics for M3 (learning modules) and M4 (export, restore, generation, metrics).
 * Like T1–T13 they run on the phone at every launch and under Node in CI.
 */
const TZ = 'America/Indiana/Indianapolis';
const DAY1 = '2026-11-27';
const at = (date: string, time: string) => new Date(`${date}T${time}:00Z`);
const count = (executor: SqlExecutor, sql: string, params: (string | number)[] = []) => executor.get<{ n: number }>(sql, params)?.n ?? -1;

function selection(executor: SqlExecutor, overrides: Partial<SelectionSettings> = {}): SelectionSettings {
  return { ...selectionSettingsFrom(readAllSettings(executor)), ...overrides };
}

function dayContext(date: string, cap = 20, a4Language = 'es-419'): ReviewDayContext {
  const { start, end } = logicalDayBounds(date, TZ);
  return { dayStart: start, dayEnd: end, cap, a4Language };
}

const t14ContentImport: DiagnosticCase = {
  id: 'T14',
  title: 'Bundled content import',
  async run(environment) {
    return withScratch(environment, 'diag_t14_content.db', (executor) => {
      const now = at(DAY1, '12:00');
      const total = bundledRows(BUNDLED_CONTENT).length;
      const first = importBundledContent(executor, BUNDLED_CONTENT, now);
      check(!first.skipped && first.inserted === total, `first import inserted ${first.inserted}/${total}`);
      check(count(executor, 'SELECT count(*) AS n FROM content_item') === total, 'row count');
      check(importBundledContent(executor, BUNDLED_CONTENT, now).skipped, 'unchanged bundle not skipped');
      const forced = importBundledContent(executor, BUNDLED_CONTENT, now, { force: true });
      check(forced.unchanged === total && forced.inserted === 0 && forced.updated === 0, 'forced re-import changed rows');

      const firstWord = BUNDLED_CONTENT.a1[0];
      check(firstWord !== undefined, 'no A1 words bundled');
      executor.run("UPDATE content_item SET status = 'served', served_on = ? WHERE id = ?", [DAY1, firstWord.id]);
      const edited: BundledContentSet = { ...BUNDLED_CONTENT, a1: [{ ...firstWord, definition: `${firstWord.definition} (revised)` }, ...BUNDLED_CONTENT.a1.slice(1)] };
      const update = importBundledContent(executor, edited, now);
      check(update.updated === 1 && update.inserted === 0, `content update: ${update.updated} updated`);
      const row = executor.get<{ status: string; payload_json: string }>('SELECT status, payload_json FROM content_item WHERE id = ?', [firstWord.id]);
      check(row?.status === 'served' && row.payload_json.includes('(revised)'), 'served status lost or payload not updated');

      for (const word of BUNDLED_CONTENT.a1) {
        check(sentenceUsesWord(word.example_sentence, [word.headword, ...word.inflections]), `${word.id}: example sentence does not use the word`);
      }
      let formulas = 0;
      for (const concept of BUNDLED_CONTENT.a3) {
        const ids = concept.question.options.map((option) => option.id);
        check(ids.filter((id) => id === concept.question.correct_option_id).length === 1, `${concept.id}: correct option`);
        if (concept.formula) {
          const rendered = formulaToText(concept.formula);
          check(!/[\\{}\u0001\u0002]/.test(rendered), `${concept.id}: formula renders with markup left: ${rendered}`);
          formulas += 1;
        }
      }
      const m = first.byModule;
      return `${total} items (A1 ${m.A1}, A3 ${m.A3}, A4 ${m.A4}, A5 ${m.A5}); re-import skipped; update keeps served status; ${formulas} formulas render`;
    });
  },
};

const t15DailyAssignment: DiagnosticCase = {
  id: 'T15',
  title: 'Daily content assignment and A1 rule',
  async run(environment) {
    return withScratch(environment, 'diag_t15_assignment.db', (executor) => {
      importBundledContent(executor, BUNDLED_CONTENT, at(DAY1, '12:00'));
      const settings = selection(executor);
      const day1 = assignDailyContent(executor, { today: DAY1, settings });
      check(day1.A1 && day1.A3 && day1.A4 && day1.A5, 'a module got no item');
      const again = assignDailyContent(executor, { today: DAY1, settings });
      check(again.A1?.row.id === day1.A1.row.id && again.A3?.row.id === day1.A3.row.id && again.A4?.row.id === day1.A4.row.id, 'assignment not stable');
      check(day1.A4.payload.cefr === settings.a4Level, `A4 level ${day1.A4.payload.cefr}, expected ${settings.a4Level} first`);
      check(day1.A5.payload.date_key === DAY1.slice(5), 'A5 date key');

      const reserved = executor.all<{ id: string; assigned_on: string; status: string }>(
        "SELECT id, assigned_on, status FROM content_item WHERE module = 'A1' AND assigned_on > ? ORDER BY assigned_on",
        [DAY1],
      );
      check(reserved.length === 13 && new Set(reserved.map((r) => r.id)).size === 13 && reserved.every((r) => r.status === 'unserved'), `A1 reservations ${reserved.length}`);
      const text = createNotificationText(executor, { enabled: settings.enabled, timeZone: TZ, reviewCap: 20, a4Language: 'es-419' });
      const tomorrowWord = assignedItem(executor, 'A1', addDays(DAY1, 1))?.payload.headword ?? '?';
      check(text(addDays(DAY1, 1), 'morning').body.includes(tomorrowWord), 'morning notification does not name the reserved word');

      const day2 = assignDailyContent(executor, { today: addDays(DAY1, 1), settings });
      check(day2.A1?.payload.headword === tomorrowWord, 'reserved word not used on its day');
      const domains = new Set<string>([day1.A3.row.domain ?? '', day2.A3?.row.domain ?? '']);
      for (let offset = 2; offset < 6; offset += 1) domains.add(assignDailyContent(executor, { today: addDays(DAY1, offset), settings }).A3?.row.domain ?? '');
      check(domains.size === 6, `A3 rotated through ${domains.size} of 6 domains in 6 days`);

      const tier3 = assignDailyContent(executor, { today: addDays(DAY1, 6), settings: { ...settings, a1Tier: '3' } });
      check(count(executor, "SELECT count(*) AS n FROM content_item WHERE module = 'A1' AND status = 'unserved' AND assigned_on IS NOT NULL AND tier_or_level != '3'") === 0, 'tier change kept old-tier reservations');
      check(tier3.A1?.payload.tier === 3, 'tier change did not switch the word of the day');

      const before = assignDailyContent(executor, { today: addDays(DAY1, 7), settings }).A1;
      check(before, 'no A1 on day 8');
      excludeContentItem(executor, before.row.id, 'diagnostic');
      const replaced = assignDailyContent(executor, { today: addDays(DAY1, 7), settings }).A1;
      check(replaced && replaced.row.id !== before.row.id, 'reported item not replaced');

      const forms = ['obviate', 'obviates', 'obviated', 'obviating'];
      check(sentenceUsesWord('Backups OBVIATED the risk.', forms), 'inflection, any case');
      check(sentenceUsesWord('“Obviate,” she said.', forms), 'punctuation around the word');
      check(!sentenceUsesWord('It was unobviated.', forms), 'substring accepted');
      check(!sentenceUsesWord('', forms), 'empty sentence accepted');
      return `stable daily items; 13 A1 words reserved and named in notifications; A3 rotated 6 domains; tier change and Report error handled`;
    });
  },
};

const t16PhraseMatching: DiagnosticCase = {
  id: 'T16',
  title: 'A4 tolerant phrase matching',
  async run() {
    const cases: [string, string, boolean, string][] = [
      ['mucho gusto', 'Mucho gusto.', true, 'exact'],
      ['¿como estas?', '¿Cómo estás?', true, 'exact'],
      ['como estas', '¿Cómo estás?', false, 'fail'],
      ['muchos gusto', 'Mucho gusto.', true, 'close'],
      ['senor', 'Señor', true, 'exact'],
      ['hola', 'Mucho gusto.', true, 'fail'],
      ['', 'Mucho gusto.', true, 'fail'],
      ['Me gustaria un cafe por favor', 'Me gustaría un café, por favor.', true, 'exact'],
      ['me gustaria un cafe por fabor', 'Me gustaría un café, por favor.', true, 'close'],
    ];
    for (const [typed, target, accentsOptional, expected] of cases) {
      const result = matchPhrase(typed, target, accentsOptional).result;
      check(result === expected, `"${typed}" vs "${target}" (accents ${accentsOptional ? 'optional' : 'exact'}): ${result}, expected ${expected}`);
    }
    return `${cases.length} cases: case, punctuation and accents handled; ≤15% edits pass as close`;
  },
};

const t17ReviewQueue: DiagnosticCase = {
  id: 'T17',
  title: 'A2 review queue, cap and card faces',
  async run(environment) {
    const scheduler: AppScheduler = await environment.createScheduler(0.9);
    return withScratch(environment, 'diag_t17_review.db', (executor) => {
      importBundledContent(executor, BUNDLED_CONTENT, at(DAY1, '12:00'));
      const settings = selection(executor);
      const day1 = assignDailyContent(executor, { today: DAY1, settings });
      check(day1.A1 && day1.A3 && day1.A4 && day1.A5, 'missing items');
      const ctx1 = dayContext(DAY1);
      const now1 = at(DAY1, '14:00');
      check(pendingRecall(executor, DAY1) === null, 'recall due on day 1');
      completeA1(executor, scheduler, { date: DAY1, item: day1.A1, sentence: `We ${day1.A1.payload.inflections[0] ?? day1.A1.payload.headword} it daily.`, now: now1, dueAt: ctx1.dayEnd });
      completeA1(executor, scheduler, { date: DAY1, item: day1.A1, sentence: `Again: ${day1.A1.payload.headword}.`, now: now1, dueAt: ctx1.dayEnd });
      markConceptRead(executor, { date: DAY1, item: day1.A3, now: now1 });
      completeA4(executor, scheduler, {
        date: DAY1, item: day1.A4, attempts: [{ typed: day1.A4.payload.phrase, result: 'exact', distance: 0, normalized_distance: 0 }],
        revealedBeforePass: false, now: now1, dueAt: ctx1.dayEnd,
      });
      markA5Opened(executor, { date: DAY1, item: day1.A5, now: now1 });
      check(saveA5EventCard(executor, scheduler, { item: day1.A5, eventIndex: 0, now: now1, dueAt: ctx1.dayEnd }), 'A5 card not saved');
      check(count(executor, 'SELECT count(*) AS n FROM srs_card') === 3, 'A1 twice must still give one card (expected 3 cards)');
      const status1 = computeDayStatus(executor, DAY1, settings.enabled, ctx1);
      check(['A1', 'A3', 'A4', 'A5'].every((m) => status1.modules[m as 'A1'] === 'complete'), `day 1 states ${JSON.stringify(status1.modules)}`);
      check(status1.modules.A2 === 'not_applicable', 'A2 should not apply on day 1');
      check(a2State(reviewProgress(executor, ctx1)) === 'not_applicable', 'new cards due on day 1');

      const DAY2 = addDays(DAY1, 1);
      const day2 = assignDailyContent(executor, { today: DAY2, settings });
      const recall = pendingRecall(executor, DAY2);
      check(recall?.row.id === day1.A3.row.id, 'day 2 recall is not day 1 concept');
      const ctx2 = dayContext(DAY2);
      const now2 = at(DAY2, '14:00');
      const answer = answerRecall(executor, scheduler, { date: DAY2, item: recall, choice: recall.payload.question.correct_option_id, now: now2, dueAt: ctx2.dayEnd });
      check(answer.correct && pendingRecall(executor, DAY2) === null, 'recall answer not recorded');
      check(computeDayStatus(executor, DAY2, settings.enabled, ctx2).modules.A3 === 'incomplete', 'A3 complete before reading day 2 concept');
      if (day2.A3) markConceptRead(executor, { date: DAY2, item: day2.A3, now: now2 });
      check(computeDayStatus(executor, DAY2, settings.enabled, ctx2).modules.A3 === 'complete', 'A3 not complete after recall + read');

      const at2 = (seconds: number) => new Date(now2.getTime() + seconds * 1000);
      const progress = reviewProgress(executor, ctx2, now2);
      check(progress.queue.length === 3 && progress.firstPass.length === 3, `day 2 queue ${progress.queue.length}`);
      const capped = reviewProgress(executor, { ...ctx2, cap: 2 }, now2);
      check(capped.queue.length === 2 && capped.deferred === 1, 'cap not applied');
      check(reviewProgress(executor, { ...ctx2, a4Language: 'fr' }, now2).queue.every((card) => !card.id.startsWith('A4:')), 'paused language still queued');

      for (const card of progress.queue) {
        const face = describeCard(executor, card.id);
        check(face !== null && face.prompt.length > 0 && face.answer.length > 0, `no face for ${card.id}`);
        if (card.id.startsWith('A4:')) check(face?.production?.target === day1.A4.payload.phrase, 'A4 face target');
        if (card.id.startsWith('A1:')) check(face?.cue?.startsWith('Again:') === true, 'A1 cue is not the latest sentence');
      }
      // The v0.3.1 case: new cards graded Again, Hard and Good enter short learning steps.
      const [c1, c2, c3] = progress.queue;
      check(c1 && c2 && c3, 'three cards expected');
      const preview = previewIntervals(executor, scheduler, c1.id, at2(0), [Rating.Again, Rating.Easy]);
      check((preview.get(Rating.Again) ?? 0) < 3_600_000 && (preview.get(Rating.Easy) ?? 0) >= 86_400_000, 'interval preview');
      check(reviewProgress(executor, ctx2, at2(0)).firstPass.length === 3, 'preview wrote to the card');
      recordReview(executor, scheduler, { cardId: c1.id, grade: Rating.Again, now: at2(0), responseMs: 3000 });
      check(a2State(reviewProgress(executor, ctx2, at2(5))) === 'incomplete', 'A2 complete with cards left');
      recordReview(executor, scheduler, { cardId: c2.id, grade: Rating.Hard, now: at2(10), responseMs: 3000 });
      recordReview(executor, scheduler, { cardId: c3.id, grade: Rating.Good, now: at2(20), responseMs: 3000 });
      const afterPass = reviewProgress(executor, ctx2, at2(30));
      check(afterPass.queue.length === 0 && afterPass.learningLater.length === 3, `no card may repeat before its step (queue ${afterPass.queue.length})`);
      check(a2State(afterPass) === 'complete', 'A2 not complete after one pass');
      check(computeDayStatus(executor, DAY2, settings.enabled, ctx2).modules.A2 === 'complete', 'A2 status after one pass');
      const later = reviewProgress(executor, ctx2, at2(120));
      check(later.queue.some((card) => card.id === c1.id) && later.queue.every((card) => card.due <= at2(120).toISOString()), 'Again card did not return after its step');
      check(!later.queue.some((card) => card.id === c3.id), 'Good card returned before its 10-minute step');
      let guard = 0;
      for (let next = later.queue[0]; next && guard < 10; next = reviewProgress(executor, ctx2, at2(700 + guard * 10)).queue[0], guard += 1) {
        recordReview(executor, scheduler, { cardId: next.id, grade: Rating.Easy, now: at2(700 + guard * 10), responseMs: 2000 });
      }
      const done = reviewProgress(executor, ctx2, at2(800));
      check(done.queue.length === 0 && done.learningLater.length === 0 && a2State(done) === 'complete', `learning repeats not cleared (${done.queue.length})`);
      const evening = createNotificationText(executor, { enabled: settings.enabled, timeZone: TZ, reviewCap: 20, a4Language: 'es-419' });
      check(/due|journal/.test(evening(addDays(DAY1, 10), 'evening').body), 'evening text');
      return `3 cards from A1/A3/A4/A5 (no duplicates); recall then read completes A3; cap ${capped.queue.length}+${capped.deferred} deferred; Again/Hard/Good repeat only after their steps; A2 completes after one pass`;
    });
  },
};

const t18ExportRoundTrip: DiagnosticCase = {
  id: 'T18',
  title: 'Export → import round trip and older backups',
  async run(environment) {
    const scheduler = await environment.createScheduler(0.9);
    const openScratch = (name: string) => () => {
      const executor = environment.openScratchDatabase(name, null);
      return {
        executor,
        dispose() {
          executor.close();
          environment.deleteScratchDatabase(name);
        },
      };
    };
    const holder: { v2: BackupDocument | null } = { v2: null };
    await withScratch(
      environment,
      'diag_t18_v2.db',
      (executor) => {
        insertSampleRows(executor, scheduler);
        holder.v2 = buildBackupDocument(executor, environment.crypto, 'diag', at(DAY1, '12:00'));
      },
      2,
    );
    return withScratch(environment, 'diag_t18_export.db', (executor) => {
      insertSampleRows(executor, scheduler);
      importBundledContent(executor, BUNDLED_CONTENT, at(DAY1, '12:00'));
      assignDailyContent(executor, { today: DAY1, settings: selection(executor) });
      const files = buildExportFiles(executor, environment.crypto, { appVersion: 'diag', localDate: DAY1, now: at(DAY1, '12:00') });
      const json = files.find((file) => file.kind === 'json');
      check(json, 'no JSON export');
      const journals = files.filter((file) => file.kind === 'journal');
      check(journals.length === 1 && journals[0]?.text.includes('photosynthesis'), 'journal Markdown missing the entry');
      const document = parseExportText(json.text);
      const report = verifyBackupDocument(openScratch('diag_t18_verify.db'), environment.crypto, document);
      const rows = Object.values(report.rowsByTable).reduce((sum, n) => sum + n, 0);
      check(report.checksumsMatch && !report.upgraded, 'round-trip checksums differ');
      check(rows === Object.values(document.tables).reduce((sum, list) => sum + list.length, 0), 'row count differs');

      const tampered: BackupDocument = JSON.parse(json.text) as BackupDocument;
      const firstJournal = tampered.tables.journal_entry[0];
      check(firstJournal, 'no journal row');
      firstJournal.body_md = 'tampered';
      check(!verifyBackupDocument(openScratch('diag_t18_tamper.db'), environment.crypto, tampered).checksumsMatch, 'tampering not detected');
      let refused = false;
      try {
        parseExportText(JSON.stringify({ ...document, schema_version: CURRENT_SCHEMA_VERSION + 1 }));
      } catch {
        refused = true;
      }
      check(refused, 'newer schema accepted');

      const old = holder.v2;
      check(old !== null, 'no v2 document');
      check(old.schema_version === 2, `old document is v${old.schema_version}`);
      const upgraded = restoreBackupDocument(executor, environment.crypto, old);
      check(upgraded.upgraded && upgraded.checksumsMatch, 'v2 backup did not restore cleanly into the current schema');
      const restoredChecksums = computeTableChecksums(executor, environment.crypto);
      check(Object.keys(restoredChecksums).length > 0, 'checksums');
      return `${rows} rows exported and re-imported, checksums match; tampering and newer schemas refused; v2 backup restores into v${CURRENT_SCHEMA_VERSION}`;
    });
  },
};

const VALID_A1 = {
  headword: 'lucid', part_of_speech: 'adjective', ipa: '/ˈlusɪd/', definition: 'Expressed clearly and easy to understand.',
  etymology: 'From Latin lucidus, bright.', example_sentence: 'Her lucid summary settled the debate.',
  inflections: ['lucid'], tier: 2, tags: ['clarity'],
};

function fakeFetch(reply: (url: string, body: string) => { status: number; json: unknown }, sent: string[]): FetchLike {
  return async (url, init) => {
    sent.push(`${url}\n${init.body ?? ''}`);
    const { status, json } = reply(url, init.body ?? '');
    return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => JSON.stringify(json) };
  };
}

const t19Generation: DiagnosticCase = {
  id: 'T19',
  title: 'Generation validation, budget and privacy',
  async run(environment) {
    const a1 = validateA1Batch(
      [VALID_A1, { ...VALID_A1, headword: 'opaque', inflections: ['opaquer'] }, { ...VALID_A1, headword: 'terse', example_sentence: 'No match here at all.', inflections: ['terse'] }, { ...VALID_A1, headword: 'lucid' }],
      { tier: '2', existing: ['obviate'] },
    );
    check(a1.accepted.length === 1 && a1.rejected.length === 3, `A1 validation ${a1.accepted.length}/${a1.rejected.length}`);
    const question = { prompt: 'Which statement is correct here?', options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: `Option ${id}` })), correct_option_id: 'b', explanation: 'Because option b is right.' };
    const explainer = Array.from({ length: 250 }, (_, i) => `w${i}`).join(' ');
    const concept = { title: 'Test concept', domain: 'physics', depth: 'intermediate', explainer, formula: null, source: null, question, tags: ['test'] };
    const a3 = validateA3Batch(
      [concept, { ...concept, title: 'Bad key', question: { ...question, correct_option_id: 'e' } }, { ...concept, title: 'Three options', question: { ...question, options: question.options.slice(0, 3) } }, { ...concept, title: 'Wrong domain', domain: 'biology' }, { ...concept, title: 'Too short', explainer: 'Short.' }],
      { domain: 'physics', explainerWords: 250, existing: [] },
    );
    check(a3.accepted.length === 1 && a3.rejected.length === 4, `A3 validation ${a3.accepted.length}/${a3.rejected.length}`);
    const phrase = { phrase: 'こんにちは', literal_translation: 'today is', idiomatic_translation: 'Hello', usage_note: 'Daytime greeting.', register: 'neutral', cefr: 'A1', transliteration: 'konnichiwa', tags: ['greetings'] };
    const a4 = validateA4Batch([phrase, { ...phrase, phrase: 'おはよう', transliteration: null }], { language: 'ja', level: 'A1', existing: [] });
    check(a4.accepted.length === 1 && a4.rejected[0]?.reason.includes('transliteration') === true, 'non-Latin transliteration rule');
    const es = validateA4Batch([{ ...phrase, phrase: '¿Vosotros venís?', transliteration: null }], { language: 'es-419', level: 'A1', existing: [] });
    check(es.accepted.length === 0, 'vosotros accepted in es-419');

    const feed = { selected: [{ text: 'A sample event happened on this date in history.', year: 1900, pages: [{ titles: { normalized: 'Sample' }, content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Sample' } } }] }] };
    const parsed = parseOnThisDayFeed('11-27', feed);
    check(parsed?.events.length === 1 && parsed.attribution !== undefined, 'Wikimedia feed parse');

    return withScratch(environment, 'diag_t19_generation.db', async (executor) => {
      const now = at(DAY1, '15:00');
      writeSetting(executor, 'modules.enabled', ['A1', 'D3'], now);
      executor.run("INSERT INTO journal_entry (date, body_md, created_at, updated_at) VALUES (?, 'SECRET-JOURNAL-TEXT', ?, ?)", [DAY1, now.toISOString(), now.toISOString()]);
      executor.run("INSERT INTO priority (date, position, text) VALUES (?, 1, 'SECRET-PRIORITY-TEXT')", [DAY1]);
      const sent: string[] = [];
      const ok = fakeFetch(() => ({ status: 200, json: { content: [{ type: 'text', text: JSON.stringify([VALID_A1, { ...VALID_A1, headword: 'terse', inflections: ['terse', 'terser'], example_sentence: 'A terse note.' }]) }], usage: { input_tokens: 900, output_tokens: 700 } } }), sent);
      const settings = readAllSettings(executor);
      const outcome = await runOneRefill({ executor, fetchImpl: ok, apiKey: 'test-key', settings, now });
      check(outcome?.status === 'succeeded' && outcome.accepted === 2, `refill outcome ${outcome?.status} ${outcome?.accepted}`);
      check(sent.length === 1 && sent.every((body) => !body.includes('SECRET-JOURNAL-TEXT') && !body.includes('SECRET-PRIORITY-TEXT')), 'personal text sent');
      const request = executor.get<{ input_tokens: number; output_tokens: number; status: string }>('SELECT * FROM generation_request ORDER BY id DESC LIMIT 1');
      check(request?.input_tokens === 900 && request.output_tokens === 700, 'token counts not recorded');
      check(count(executor, "SELECT count(*) AS n FROM content_item WHERE source = 'generated' AND module = 'A1' AND status = 'unserved'") === 2, 'generated items not stored');

      const failing = fakeFetch(() => ({ status: 500, json: { error: { message: 'overloaded' } } }), sent);
      const failed = await runOneRefill({ executor, fetchImpl: failing, apiKey: 'test-key', settings, now: new Date(now.getTime() + 60_000) });
      check(failed?.status === 'failed', 'HTTP failure not recorded');
      const retried = await runOneRefill({ executor, fetchImpl: ok, apiKey: 'test-key', settings, now: new Date(now.getTime() + 120_000) });
      check(retried === null, 'retried within 6 hours of a failure');

      writeSetting(executor, 'generation.monthly_request_budget', 0, now);
      const callsBefore = sent.length;
      const blocked = await runOneRefill({ executor, fetchImpl: ok, apiKey: 'test-key', settings: readAllSettings(executor), now: new Date(now.getTime() + 7 * 3_600_000) });
      check(blocked === null && sent.length === callsBefore, 'budget cap not enforced');

      const wm = fakeFetch(() => ({ status: 200, json: feed }), []);
      check((await fetchOnThisDayIfMissing(executor, wm, '06-15', now)) === 'stored', 'A5 fetch not stored');
      check((await fetchOnThisDayIfMissing(executor, wm, '06-15', now)) === 'exists', 'A5 fetched twice');
      return 'A1/A3/A4 validators reject 8 bad items; refill stores 2 items with token counts; no journal or priority text sent; failures back off; budget 0 blocks; Wikimedia fallback stores once';
    });
  },
};

const t20Metrics: DiagnosticCase = {
  id: 'T20',
  title: 'Adherence and learning metrics',
  async run(environment) {
    check(spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) === 1, 'Spearman +1');
    check(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]) === -1, 'Spearman −1');
    const tied = spearman([1, 2, 2, 3], [1, 2, 3, 4]);
    check(tied !== null && Math.abs(tied - 0.9486832980505138) < 1e-9, `Spearman with ties ${tied}`);
    check(median([5, 1, 3]) === 3 && median([4, 1, 3, 2]) === 2.5 && median([]) === null, 'median');
    return withScratch(environment, 'diag_t20_metrics.db', (executor) => {
      // Fixture rows only: review-log rows reference no real card.
      executor.exec('PRAGMA foreign_keys = OFF');
      const days = [DAY1, addDays(DAY1, 1), addDays(DAY1, 2), addDays(DAY1, 3)];
      const enabled = ['A1', 'A2', 'D1', 'D3'];
      // Day 1: 4/4 modules, both windows; day 2: 2/4, morning; day 3: 0; day 4 (today): 1/4.
      const done: Record<string, string[]> = { [days[0] as string]: ['A1', 'A2', 'D1', 'D3'], [days[1] as string]: ['A1', 'D1'], [days[3] as string]: ['A1'] };
      for (const date of days) executor.run('INSERT INTO daily_session (date, morning_completed_at, evening_completed_at) VALUES (?, ?, ?)', [date, date === days[0] || date === days[1] ? `${date}T13:00:00.000Z` : null, date === days[0] ? `${date}T23:00:00.000Z` : null]);
      for (const [date, modules] of Object.entries(done)) {
        for (const module of modules) executor.run('INSERT INTO task_completion (date, module, completed_at) VALUES (?, ?, ?)', [date, module, `${date}T13:${module === 'A1' ? '30' : '45'}:00.000Z`]);
      }
      executor.run("INSERT INTO task_completion (date, module, content_item_id, completed_at, response_json) VALUES (?, 'A3R', NULL, ?, '{\"choice\":\"a\",\"correct\":true}')", [days[1] as string, `${days[1]}T13:00:00.000Z`]);
      executor.run("INSERT INTO task_completion (date, module, content_item_id, completed_at, response_json) VALUES (?, 'A3R', NULL, ?, '{\"choice\":\"b\",\"correct\":false}')", [days[2] as string, `${days[2]}T13:00:00.000Z`]);
      executor.run("INSERT INTO task_completion (date, module, completed_at, response_json) VALUES (?, 'A4', ?, '{\"first_result\":\"close\",\"first_normalized_distance\":0.1}')", [days[1] as string, `${days[1]}T13:50:00.000Z`]);
      executor.run("INSERT INTO priority (date, position, text, status) VALUES (?, 1, 'x', 'done'), (?, 2, 'y', 'partial')", [days[0] as string, days[0] as string]);
      executor.run("INSERT INTO priority (date, position, text, status) VALUES (?, 1, 'z', 'not_done')", [days[1] as string]);
      executor.run("INSERT INTO notification_schedule (os_notification_id, window, fire_at, date, status) VALUES ('n1', 'morning', ?, ?, 'fired'), ('n2', 'morning', ?, ?, 'fired')", [`${days[0]}T13:00:00.000Z`, days[0] as string, `${days[1]}T13:00:00.000Z`, days[1] as string]);
      for (const [grade, elapsed] of [[3, 3], [1, 3], [3, 10], [4, 40]] as const) {
        executor.run("INSERT INTO srs_review_log (card_id, grade, reviewed_at, elapsed_days, scheduled_days, state_before, revlog_json) VALUES ('A1:x', ?, ?, ?, 5, 2, '{}')", [grade, `${days[1]}T14:00:00.000Z`, elapsed]);
      }
      executor.run("INSERT INTO journal_entry (date, body_md, mood, created_at, updated_at) VALUES (?, 'One two three four.', 4, ?, ?)", [days[0] as string, `${days[0]}T23:00:00Z`, `${days[0]}T23:00:00Z`]);
      const stats = computeStats(executor, { today: days[3] as string, trackingStart: DAY1, enabledModules: enabled, targetRetention: 0.9, moodEnabled: true });
      check(stats.days.length === 4, `range ${stats.days.length} days`);
      check(Math.abs((stats.adherence.mean ?? -1) - (1 + 0.5 + 0 + 0.25) / 4) < 1e-9, `adherence ${stats.adherence.mean}`);
      check(stats.windowCompletion.morning.numerator === 2 && stats.windowCompletion.morning.denominator === 3, 'morning rate (today not elapsed)');
      check(stats.retrieval.overall.numerator === 3 && stats.retrieval.overall.denominator === 4, 'retrieval share');
      check(Math.abs((stats.retrieval.calibrationGap ?? 0) - (0.75 - 0.9)) < 1e-9, 'calibration gap');
      check(stats.retrieval.byElapsed['2–6']?.denominator === 2 && stats.retrieval.byElapsed['≥30']?.numerator === 1, 'elapsed buckets');
      check(stats.delayedRecall.numerator === 1 && stats.delayedRecall.denominator === 2, 'delayed recall');
      check(stats.production.close.numerator === 1 && stats.production.meanNormalizedDistance === 0.1, 'production accuracy');
      check(Math.abs((stats.priorities.meanScore ?? -1) - (0.75 + 0) / 2) < 1e-9, `priority score ${stats.priorities.meanScore}`);
      check(stats.journal.wordsPerEntry === 4, 'words per entry');
      check(stats.latency.medianMinutes === 30 && stats.latency.samples === 2, `latency ${stats.latency.medianMinutes}`);
      check(stats.moodAdherence.rho === null && stats.moodAdherence.pairs === 1, 'Spearman shown before 30 pairs');
      return 'adherence, window rates, retrieval + calibration gap, recall, production, priorities, journal, latency and Spearman match hand-computed values';
    });
  },
};

const t21DailyModuleStates: DiagnosticCase = {
  id: 'T21',
  title: 'Per-day module states and fair adherence',
  async run(environment) {
    return withScratch(
      environment,
      'diag_t21_states.db',
      (executor) => {
        executor.run("INSERT INTO daily_session (date, morning_completed_at) VALUES ('2026-11-26', '2026-11-26T13:00:00.000Z')");
        const migration = runMigrations(executor);
        check(migration.fromVersion === 3 && migration.toVersion === CURRENT_SCHEMA_VERSION, `migrated ${migration.fromVersion}→${migration.toVersion}`);
        const kept = executor.get<{ morning_completed_at: string | null; module_states_json: string | null }>(
          "SELECT morning_completed_at, module_states_json FROM daily_session WHERE date = '2026-11-26'",
        );
        check(kept?.morning_completed_at === '2026-11-26T13:00:00.000Z' && kept.module_states_json === null, 'v3 row not kept as is');

        const date = '2026-11-27';
        const enabled = ['A1', 'A2', 'D1', 'D2', 'D3'];
        const now = at(date, '23:00');
        executor.run("INSERT INTO daily_session (date) VALUES (?)", [date]);
        executor.run("INSERT INTO priority (date, position, text) VALUES (?, 1, 'one')", [date]);
        executor.run("INSERT INTO journal_entry (date, body_md, created_at, updated_at) VALUES (?, 'Some words today.', ?, ?)", [date, now.toISOString(), now.toISOString()]);
        const status = computeDayStatus(executor, date, enabled, dayContext(date));
        check(status.modules.A1 === 'no_content' && status.modules.A2 === 'not_applicable', `states ${JSON.stringify(status.modules)}`);
        check(status.modules.D1 === 'complete' && status.modules.D2 === 'incomplete' && status.modules.D3 === 'complete', 'D states');
        recordDayStatus(executor, status, now);
        const stored = executor.get<{ module_states_json: string | null }>('SELECT module_states_json FROM daily_session WHERE date = ?', [date]);
        check(stored?.module_states_json?.includes('"A2":"not_applicable"') === true, 'states not stored');

        const stats = computeStats(executor, { today: date, trackingStart: '2026-11-26', enabledModules: enabled, targetRetention: 0.9, moodEnabled: false });
        const today = stats.adherence.series[stats.days.indexOf(date)];
        check(today !== undefined && today !== null && Math.abs(today - 2 / 3) < 1e-9, `adherence ${today}, expected 2/3 (old formula 2/5)`);
        check(stats.adherence.basis.applicable === 1 && stats.adherence.basis.enabled === 1, 'basis counts');
        return 'm0004 keeps v3 rows; states stored per day; adherence 2/3 (D1, D3 of D1–D3) instead of 2/5; earlier days use the old formula';
      },
      3,
    );
  },
};

export const M3_DIAGNOSTIC_CASES: readonly DiagnosticCase[] = [
  t14ContentImport,
  t15DailyAssignment,
  t16PhraseMatching,
  t17ReviewQueue,
  t18ExportRoundTrip,
  t19Generation,
  t20Metrics,
  t21DailyModuleStates,
];
