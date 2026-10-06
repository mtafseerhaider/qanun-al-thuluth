import { supabase } from './client';

/**
 * Subscribes to row changes of one table filtered by `filter` (for example `id=eq.<uuid>`), the
 * Realtime contract returned by async Edge Functions (06 §2.9 `AsyncAccepted.realtime`). Returns an
 * unsubscribe function. When Supabase is not configured, or the channel errors, `onStatus` reports it
 * so callers fall back to polling.
 */
export function subscribeToRowChanges<Row extends Record<string, unknown>>(opts: {
  channel: string;
  schema?: string;
  table: string;
  filter: string;
  onChange: (row: Row) => void;
  onStatus?: (status: 'subscribed' | 'error' | 'closed') => void;
}): () => void {
  const client = supabase;
  if (!client) {
    opts.onStatus?.('error');
    return () => undefined;
  }
  const channel = client
    .channel(opts.channel)
    .on(
      'postgres_changes',
      { event: '*', schema: opts.schema ?? 'public', table: opts.table, filter: opts.filter },
      (payload) => {
        const row = payload.new as Row | undefined;
        if (row && Object.keys(row).length > 0) opts.onChange(row);
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') opts.onStatus?.('subscribed');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') opts.onStatus?.('error');
      else if (status === 'CLOSED') opts.onStatus?.('closed');
    });
  return () => {
    void client.removeChannel(channel);
  };
}
