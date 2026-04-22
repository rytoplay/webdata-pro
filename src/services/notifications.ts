import { db } from '../db/knex';
import { sendNewRecordNotification } from './email';

interface AppLike {
  id: number;
  name: string;
  notify_admin_email?: string | null;
  notify_tables_json?: string | null;
  notify_mode?: string | null;
}

/**
 * Called after a record is successfully inserted. Checks whether admin
 * notifications are enabled for this table and sends immediately or queues
 * for the daily digest.
 */
export async function maybeNotify(
  app: AppLike,
  tableName: string,
  recordId: string | null,
  submittedBy: string,
): Promise<void> {
  try {
    if (!app.notify_admin_email || !app.notify_tables_json) return;

    const enabledTables: string[] = JSON.parse(app.notify_tables_json);
    if (!enabledTables.includes(tableName)) return;

    // Look up the human-readable table label
    const tableRow = await db('app_tables')
      .where({ app_id: app.id, table_name: tableName })
      .select('label')
      .first();
    const tableLabel = tableRow?.label ?? tableName;

    const mode = app.notify_mode ?? 'immediate';

    if (mode === 'daily') {
      await db('notification_queue').insert({
        app_id:       app.id,
        table_name:   tableName,
        table_label:  tableLabel,
        record_id:    recordId,
        submitted_by: submittedBy,
        queued_at:    new Date().toISOString(),
      });
    } else {
      // Fire-and-forget — don't let email failure break the request
      sendNewRecordNotification(
        app.notify_admin_email,
        app.name,
        tableLabel,
        recordId,
        submittedBy,
      ).catch((err: unknown) => {
        console.error('[notifications] immediate send failed:', err);
      });
    }
  } catch (err) {
    // Never throw — a notification failure must not break record creation
    console.error('[notifications] maybeNotify error:', err);
  }
}
