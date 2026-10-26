// Local SQLite storage (sql.js / WASM). The database lives in memory and is written
// to disk atomically (temp file + rename) after every committed change.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import type {
  DayTotal,
  EntryPatch,
  EntrySource,
  IntakeEntry,
  ReminderAction,
  ReminderCounts,
  ReminderRecord,
  Settings,
} from '../shared/types';
import { DEFAULT_SETTINGS, sanitizeStoredSettings } from '../shared/settings';
import { addLocalDays, localDateKey, startOfLocalDay } from '../shared/time';

const SCHEMA_VERSION = 1;
const MAX_AMOUNT = 5000;
const SOURCES: EntrySource[] = ['reminder', 'manual', 'quick'];

const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE intake_entries (
      id          TEXT PRIMARY KEY,
      amount_ml   INTEGER NOT NULL CHECK (amount_ml > 0 AND amount_ml <= ${MAX_AMOUNT}),
      timestamp   TEXT NOT NULL,
      source      TEXT NOT NULL CHECK (source IN ('reminder', 'manual', 'quick')),
      note        TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX idx_intake_timestamp ON intake_entries (timestamp);
    CREATE TABLE reminder_history (
      id                TEXT PRIMARY KEY,
      reminder_at       TEXT NOT NULL,
      action            TEXT NOT NULL CHECK (action IN ('drank', 'later', 'skipped', 'dismissed')),
      action_at         TEXT NOT NULL,
      detail            TEXT,
      next_reminder_at  TEXT,
      water_entry_id    TEXT REFERENCES intake_entries (id) ON DELETE SET NULL
    );
    CREATE INDEX idx_reminder_at ON reminder_history (reminder_at);
  `,
};

export class ValidationError extends Error {}

export interface ReminderOutcome {
  reminderId: string;
  firedAt: number;
  action: ReminderAction;
  actionAt: number;
  detail?: string | null;
  nextAt: number | null;
  /** Amount to record when action === 'drank'. */
  amountMl?: number;
  /** Existing entry to link instead of creating one (drink logged from the dashboard). */
  existingEntryId?: string;
}

const iso = (t: number) => new Date(t).toISOString();

export class Store {
  /** Set when the file could not be read or written; surfaced in the UI. */
  storageError: string | null = null;

  private constructor(
    private db: Database,
    private filePath: string | null,
  ) {}

  /** Opens (or creates) the database. filePath null = in-memory only (tests). */
  static async open(filePath: string | null, wasmBinary?: ArrayBuffer): Promise<Store> {
    const SQL = await initSqlJs(wasmBinary ? { wasmBinary } : undefined);
    let db: Database | null = null;
    let notice: string | null = null;

    if (filePath && fs.existsSync(filePath)) {
      try {
        db = new SQL.Database(fs.readFileSync(filePath));
        const check = db.exec('PRAGMA quick_check')[0]?.values[0]?.[0];
        if (check !== 'ok') throw new Error(`integrity check: ${String(check)}`);
      } catch (err) {
        db?.close();
        db = null;
        const aside = `${filePath}.corrupt-${Date.now()}`;
        fs.renameSync(filePath, aside);
        notice = `The data file could not be read (${(err as Error).message}). A new one was created; the old file was kept as ${aside}.`;
      }
    }
    if (!db) db = new SQL.Database();
    if (filePath) fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const store = new Store(db, filePath);
    store.migrate();
    store.storageError = notice;
    return store;
  }

  private migrate() {
    this.db.exec('PRAGMA foreign_keys = ON');
    const current = Number(this.db.exec('PRAGMA user_version')[0].values[0][0]);
    if (current >= SCHEMA_VERSION) return;
    this.tx(() => {
      for (let v = current + 1; v <= SCHEMA_VERSION; v++) this.db.exec(MIGRATIONS[v]);
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  }

  /** Runs fn in a transaction and persists on commit. */
  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    let result: T;
    try {
      result = fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.persist();
    return result;
  }

  private persist() {
    if (!this.filePath) return;
    try {
      const data = this.db.export();
      // export() resets connection pragmas in sql.js
      this.db.exec('PRAGMA foreign_keys = ON');
      const tmp = `${this.filePath}.tmp`;
      const fd = fs.openSync(tmp, 'w', 0o600);
      try {
        fs.writeSync(fd, data);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      replaceFile(tmp, this.filePath);
      if (this.storageError?.startsWith('Could not save')) this.storageError = null;
    } catch (err) {
      this.storageError = `Could not save data to disk: ${(err as Error).message}`;
    }
  }

  private all(sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: Record<string, SqlValue>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  private run(sql: string, params: SqlValue[] = []) {
    this.db.run(sql, params);
  }

  // ---------- key/value ----------

  getSettings(): Settings {
    const rows = this.all('SELECT key, value FROM settings');
    const raw: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        raw[String(r.key)] = JSON.parse(String(r.value));
      } catch {
        /* ignore corrupt value; default is used */
      }
    }
    return rows.length ? sanitizeStoredSettings(raw) : { ...DEFAULT_SETTINGS };
  }

  saveSettings(settings: Settings) {
    this.tx(() => {
      for (const [k, v] of Object.entries(settings)) {
        this.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
          k,
          JSON.stringify(v),
        ]);
      }
    });
  }

  getMeta<T>(key: string): T | null {
    const row = this.all('SELECT value FROM meta WHERE key = ?', [key])[0];
    if (!row) return null;
    try {
      return JSON.parse(String(row.value)) as T;
    } catch {
      return null;
    }
  }

  setMeta(key: string, value: unknown) {
    this.tx(() =>
      this.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
        key,
        JSON.stringify(value),
      ]),
    );
  }

  // ---------- intake ----------

  private validateAmount(amount: unknown): number {
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      throw new ValidationError(`Amount must be a whole number between 1 and ${MAX_AMOUNT} ml.`);
    }
    return amount;
  }

  private validateTimestamp(ts: unknown, now: number): string {
    const t = typeof ts === 'string' ? Date.parse(ts) : NaN;
    if (!Number.isFinite(t)) throw new ValidationError('Invalid date/time.');
    if (t > now + 5 * 60_000) throw new ValidationError('Entries cannot be in the future.');
    if (t < now - 3650 * 86_400_000) throw new ValidationError('That date is too far in the past.');
    return iso(t);
  }

  private validateNote(note: unknown): string | null {
    if (note === undefined || note === null || note === '') return null;
    if (typeof note !== 'string' || note.length > 500) throw new ValidationError('Note must be text up to 500 characters.');
    return note.trim() || null;
  }

  private insertEntry(amountMl: number, timestamp: string, source: EntrySource, note: string | null, now: number) {
    const entry: IntakeEntry = { id: randomUUID(), amountMl, timestamp, source, note };
    this.run(
      'INSERT INTO intake_entries (id, amount_ml, timestamp, source, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [entry.id, amountMl, timestamp, source, note, iso(now)],
    );
    return entry;
  }

  addEntry(input: { amountMl: unknown; timestamp?: unknown; source: unknown; note?: unknown }, now = Date.now()) {
    const amount = this.validateAmount(input.amountMl);
    const ts = input.timestamp === undefined ? iso(now) : this.validateTimestamp(input.timestamp, now);
    if (!SOURCES.includes(input.source as EntrySource)) throw new ValidationError('Invalid entry source.');
    const note = this.validateNote(input.note);
    return this.tx(() => this.insertEntry(amount, ts, input.source as EntrySource, note, now));
  }

  updateEntry(id: string, patch: EntryPatch, now = Date.now()): IntakeEntry {
    const existing = this.getEntry(id);
    if (!existing) throw new ValidationError('Entry not found.');
    const next: IntakeEntry = {
      ...existing,
      amountMl: patch.amountMl === undefined ? existing.amountMl : this.validateAmount(patch.amountMl),
      timestamp: patch.timestamp === undefined ? existing.timestamp : this.validateTimestamp(patch.timestamp, now),
      note: patch.note === undefined ? existing.note : this.validateNote(patch.note),
    };
    this.tx(() =>
      this.run('UPDATE intake_entries SET amount_ml = ?, timestamp = ?, note = ? WHERE id = ?', [
        next.amountMl,
        next.timestamp,
        next.note,
        id,
      ]),
    );
    return next;
  }

  deleteEntry(id: string): boolean {
    if (!this.getEntry(id)) return false;
    this.tx(() => this.run('DELETE FROM intake_entries WHERE id = ?', [id]));
    return true;
  }

  getEntry(id: string): IntakeEntry | null {
    const row = this.all('SELECT * FROM intake_entries WHERE id = ?', [id])[0];
    return row ? toEntry(row) : null;
  }

  entriesBetween(from: number, to: number): IntakeEntry[] {
    return this.all('SELECT * FROM intake_entries WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp', [
      iso(from),
      iso(to),
    ]).map(toEntry);
  }

  /** Deletes the intake entries of the local day containing `now`. Reminder history is kept. */
  resetDay(now = Date.now()): number {
    const from = startOfLocalDay(now);
    const to = addLocalDays(from, 1);
    return this.tx(() => {
      const n = this.all('SELECT COUNT(*) AS n FROM intake_entries WHERE timestamp >= ? AND timestamp < ?', [
        iso(from),
        iso(to),
      ])[0].n as number;
      this.run('DELETE FROM intake_entries WHERE timestamp >= ? AND timestamp < ?', [iso(from), iso(to)]);
      return n;
    });
  }

  /** Totals per local calendar day, oldest first, for `days` days ending on the day of `now`. */
  dailyTotals(days: number, now = Date.now()): (DayTotal & { entries: IntakeEntry[] })[] {
    const todayStart = startOfLocalDay(now);
    const from = addLocalDays(todayStart, -(days - 1));
    const to = addLocalDays(todayStart, 1);
    const buckets = new Map<string, DayTotal & { entries: IntakeEntry[] }>();
    for (let d = from; d < to; d = addLocalDays(d, 1)) {
      const key = localDateKey(d);
      buckets.set(key, { dateKey: key, totalMl: 0, count: 0, entries: [] });
    }
    for (const e of this.entriesBetween(from, to)) {
      const b = buckets.get(localDateKey(Date.parse(e.timestamp)));
      if (!b) continue;
      b.totalMl += e.amountMl;
      b.count += 1;
      b.entries.push(e);
    }
    return [...buckets.values()];
  }

  // ---------- reminders ----------

  /** Records what happened to a reminder; for 'drank' the water entry is written in the same transaction. */
  recordReminderOutcome(o: ReminderOutcome): { record: ReminderRecord; entry: IntakeEntry | null } {
    return this.tx(() => {
      let entry: IntakeEntry | null = null;
      if (o.action === 'drank') {
        if (o.existingEntryId) entry = this.getEntry(o.existingEntryId);
        else entry = this.insertEntry(this.validateAmount(o.amountMl), iso(o.actionAt), 'reminder', null, o.actionAt);
      }
      const record: ReminderRecord = {
        id: o.reminderId,
        reminderAt: iso(o.firedAt),
        action: o.action,
        actionAt: iso(o.actionAt),
        detail: o.detail ?? null,
        nextReminderAt: o.nextAt === null ? null : iso(o.nextAt),
        waterEntryId: entry?.id ?? null,
      };
      this.run(
        `INSERT INTO reminder_history (id, reminder_at, action, action_at, detail, next_reminder_at, water_entry_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.reminderAt, record.action, record.actionAt, record.detail, record.nextReminderAt, record.waterEntryId],
      );
      return { record, entry };
    });
  }

  remindersBetween(from: number, to: number): ReminderRecord[] {
    return this.all('SELECT * FROM reminder_history WHERE reminder_at >= ? AND reminder_at < ? ORDER BY reminder_at', [
      iso(from),
      iso(to),
    ]).map(toReminder);
  }

  static countReminders(records: ReminderRecord[]): ReminderCounts {
    const counts: ReminderCounts = { drank: 0, later: 0, skipped: 0, dismissed: 0 };
    for (const r of records) counts[r.action] += 1;
    return counts;
  }

  // ---------- export ----------

  exportAll() {
    return {
      exportedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      settings: this.getSettings(),
      intakeEntries: this.all('SELECT * FROM intake_entries ORDER BY timestamp').map(toEntry),
      reminderHistory: this.all('SELECT * FROM reminder_history ORDER BY reminder_at').map(toReminder),
    };
  }

  exportEntriesCsv(): string {
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      // Neutralise spreadsheet formula injection and quote everything.
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const lines = ['id,amount_ml,timestamp_utc,local_date,source,note'];
    for (const e of this.all('SELECT * FROM intake_entries ORDER BY timestamp').map(toEntry)) {
      lines.push([e.id, e.amountMl, e.timestamp, localDateKey(Date.parse(e.timestamp)), e.source, e.note].map(esc).join(','));
    }
    return lines.join('\n') + '\n';
  }

  /** Raw SQLite bytes, for backups. */
  exportBytes(): Uint8Array {
    const data = this.db.export();
    this.db.exec('PRAGMA foreign_keys = ON');
    return data;
  }

  close() {
    this.persist();
    this.db.close();
  }
}

/** Atomic replace. On Windows a rename onto a file briefly held open (antivirus, indexer) can fail with
 *  EPERM/EBUSY; retry a few times, then fall back to copying over it. */
function replaceFile(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      if (attempt >= 4) {
        fs.copyFileSync(from, to);
        fs.rmSync(from, { force: true });
        return;
      }
      const until = Date.now() + 25 * (attempt + 1);
      while (Date.now() < until) {
        /* brief synchronous back-off; persist() must finish before the next transaction */
      }
    }
  }
}

function toEntry(r: Record<string, SqlValue>): IntakeEntry {
  return {
    id: String(r.id),
    amountMl: Number(r.amount_ml),
    timestamp: String(r.timestamp),
    source: r.source as EntrySource,
    note: r.note === null ? null : String(r.note),
  };
}

function toReminder(r: Record<string, SqlValue>): ReminderRecord {
  return {
    id: String(r.id),
    reminderAt: String(r.reminder_at),
    action: r.action as ReminderAction,
    actionAt: String(r.action_at),
    detail: r.detail === null ? null : String(r.detail),
    nextReminderAt: r.next_reminder_at === null ? null : String(r.next_reminder_at),
    waterEntryId: r.water_entry_id === null ? null : String(r.water_entry_id),
  };
}
