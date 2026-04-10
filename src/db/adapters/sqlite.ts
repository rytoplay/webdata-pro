import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export function initializeSqliteDatabase(filePath: string): void {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolved);
  db.close();
}
