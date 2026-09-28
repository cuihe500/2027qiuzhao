import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const hashKey = (key) => createHash('sha256').update(key).digest('hex')
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000

export function openDatabase(databasePath) {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
  }

  const database = new DatabaseSync(databasePath)
  if (databasePath !== ':memory:') chmodSync(databasePath, 0o600)
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS workspaces (
      key_hash TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS progress (
      workspace_hash TEXT NOT NULL REFERENCES workspaces(key_hash) ON DELETE CASCADE,
      company TEXT NOT NULL,
      record TEXT,
      version INTEGER NOT NULL CHECK (version > 0),
      PRIMARY KEY (workspace_hash, company)
    );
    CREATE TABLE IF NOT EXISTS settings (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `)

  let workspaceHash
  database.exec('BEGIN IMMEDIATE')
  try {
    workspaceHash = database.prepare("SELECT value FROM settings WHERE name = 'single_user_workspace'").get()?.value
    if (!workspaceHash) {
      workspaceHash = database.prepare(`
        SELECT workspaces.key_hash FROM workspaces
        LEFT JOIN progress ON progress.workspace_hash = workspaces.key_hash
        GROUP BY workspaces.key_hash
        ORDER BY COUNT(progress.company) DESC, workspaces.created_at ASC, workspaces.key_hash ASC
        LIMIT 1
      `).get()?.key_hash ?? hashKey('qiuzhao-single-user:XiaoLv')
      database.prepare('INSERT OR IGNORE INTO workspaces (key_hash) VALUES (?)').run(workspaceHash)
      database.prepare("INSERT INTO settings (name, value) VALUES ('single_user_workspace', ?)").run(workspaceHash)
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    database.close()
    throw error
  }

  const retainedWorkspaces = database.prepare('SELECT COUNT(*) AS count FROM workspaces WHERE key_hash != ?').get(workspaceHash).count
  const insertSession = database.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
  const findSession = database.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?')
  const deleteSession = database.prepare('DELETE FROM sessions WHERE token_hash = ?')
  const deleteExpiredSessions = database.prepare('DELETE FROM sessions WHERE expires_at <= ?')
  const findRecords = database.prepare('SELECT company, record, version FROM progress WHERE workspace_hash = ? ORDER BY company')
  const findRecord = database.prepare('SELECT record, version FROM progress WHERE workspace_hash = ? AND company = ?')
  const saveRecord = database.prepare(`
    INSERT INTO progress (workspace_hash, company, record, version)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (workspace_hash, company) DO UPDATE SET
      record = excluded.record,
      version = excluded.version
  `)

  function getRecords() {
    return Object.fromEntries(findRecords.all(workspaceHash).map((row) => [row.company, {
      record: row.record === null ? null : JSON.parse(row.record),
      version: row.version,
    }]))
  }

  return {
    retainedWorkspaces,

    createSession(now = Date.now()) {
      deleteExpiredSessions.run(now)
      const token = randomBytes(32).toString('base64url')
      insertSession.run(hashKey(token), now, now + SESSION_MAX_AGE)
      return token
    },

    authenticateSession(token, now = Date.now()) {
      if (!token) return false
      const tokenHash = hashKey(token)
      const session = findSession.get(tokenHash)
      if (!session) return false
      if (session.expires_at <= now) {
        deleteSession.run(tokenHash)
        return false
      }
      return true
    },

    revokeSession(token) {
      if (token) deleteSession.run(hashKey(token))
    },

    getRecords,

    applyChanges(changes) {
      const conflicts = []
      database.exec('BEGIN IMMEDIATE')
      try {
        for (const change of changes) {
          const current = findRecord.get(workspaceHash, change.company)
          const nextRecord = change.record === null ? null : JSON.stringify(change.record)
          if (current && current.record === nextRecord) continue
          if ((current?.version ?? 0) !== change.baseVersion) {
            conflicts.push(change.company)
            continue
          }
          saveRecord.run(workspaceHash, change.company, nextRecord, (current?.version ?? 0) + 1)
        }
        const records = getRecords()
        database.exec('COMMIT')
        return { records, conflicts }
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },

    close() {
      database.close()
    },
  }
}
