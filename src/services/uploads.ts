import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import sharp from 'sharp';

// ── Upload restrictions (stored in ui_options_json on app_fields / app_tables) ──

export interface UploadRestrictions {
  allowed_extensions?: string;  // comma-separated: ".jpg,.png,.pdf"
  max_file_size_kb?:   number;
}

/**
 * Validate a file against per-field restrictions.
 * Returns an error message string, or null if the file is acceptable.
 */
export function validateUpload(
  file: { originalname: string; size: number },
  restrictions: UploadRestrictions,
): string | null {
  if (restrictions.max_file_size_kb && restrictions.max_file_size_kb > 0) {
    if (file.size > restrictions.max_file_size_kb * 1024) {
      const display = restrictions.max_file_size_kb >= 1024
        ? `${(restrictions.max_file_size_kb / 1024).toFixed(1)} MB`
        : `${restrictions.max_file_size_kb} KB`;
      return `File too large — maximum is ${display}`;
    }
  }
  if (restrictions.allowed_extensions?.trim()) {
    const allowed = restrictions.allowed_extensions
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean)
      .map(e => e.startsWith('.') ? e : `.${e}`);
    if (allowed.length) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowed.includes(ext)) {
        return `File type "${ext || '(no extension)'}" is not allowed — permitted: ${allowed.join(', ')}`;
      }
    }
  }
  return null;
}

// Root uploads directory (project root / uploads)
export const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
export const THUMB_SIZE = 100;

// Allowed MIME types per field type
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const UPLOAD_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]);

// multer storage — keeps files in memory for processing
export const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter(_req, file, cb) {
    if (IMAGE_TYPES.has(file.mimetype) || UPLOAD_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
}).any();

function uploadDir(appSlug: string, tableName: string, fieldName: string): string {
  return path.join(UPLOADS_DIR, appSlug, tableName, fieldName);
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'text/plain': '.txt', 'text/csv': '.csv',
  };
  return map[mime] ?? '';
}

/**
 * Save an uploaded file. For image fields, also creates a thumbnail.
 * Returns the relative path stored in the DB (e.g. "appslug/table/field/uuid.jpg").
 */
export async function saveUpload(
  buffer: Buffer,
  mime: string,
  appSlug: string,
  tableName: string,
  fieldName: string,
  isImage: boolean,
): Promise<string> {
  const dir = uploadDir(appSlug, tableName, fieldName);
  fs.mkdirSync(dir, { recursive: true });

  const uuid = crypto.randomBytes(16).toString('hex');
  const ext  = extFromMime(mime);
  const filename = `${uuid}${ext}`;
  const filepath = path.join(dir, filename);

  if (isImage) {
    // Normalize to reasonable max width/height, keep aspect ratio
    await sharp(buffer)
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .toFile(filepath);

    // Thumbnail: 100×100 cover crop
    const thumbPath = path.join(dir, `${uuid}_thumb${ext}`);
    await sharp(buffer)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
      .toFile(thumbPath);
  } else {
    fs.writeFileSync(filepath, buffer);
  }

  // Return relative path (no leading slash)
  return `${appSlug}/${tableName}/${fieldName}/${filename}`;
}

/**
 * Delete a stored file and its thumbnail (if any).
 */
export function deleteUpload(relativePath: string): void {
  if (!relativePath) return;
  const full = path.join(UPLOADS_DIR, relativePath);
  try { fs.unlinkSync(full); } catch {}
  // Try to remove thumbnail (insert _thumb before last extension)
  const thumbPath = full.replace(/(\.[^.]+)$/, '_thumb$1');
  try { fs.unlinkSync(thumbPath); } catch {}
}
