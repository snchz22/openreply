import type { parseCommentEvents } from "@/lib/meta/webhook";

type InstagramPayload = Parameters<typeof parseCommentEvents>[0];
type Entry = InstagramPayload["entry"][number];

interface FeedChange {
  field?: string;
  value?: {
    item?: string;
    verb?: string;
    comment_id?: string;
    post_id?: string;
    parent_id?: string;
    message?: string;
    from?: { id?: string; name?: string };
  };
}

interface PagePayload {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    changes?: FeedChange[];
    messaging?: Entry["messaging"];
  }>;
}

/**
 * Map a Facebook Page webhook (`object: "page"`) onto the Instagram payload
 * shape the rest of the pipeline consumes, the same trick the Zernio provider
 * uses. Two parts:
 *
 * - `changes[].field === "feed"` with `item: "comment"` and `verb: "add"` is
 *   a new comment on a Page post. It becomes an Instagram-style `comments`
 *   change with `media.id` = the post id, so campaign matching by post id
 *   (or "any post") works unchanged. Edits, removals, likes, and other feed
 *   items are dropped.
 * - `messaging[]` (Messenger messages, postbacks, reads) already has the same
 *   shape as Instagram messaging events and passes through untouched.
 *
 * Returns null when nothing in the payload is actionable.
 */
export function normalizeFacebookEvent(payload: unknown): InstagramPayload | null {
  const incoming = payload as PagePayload;
  if (!incoming || incoming.object !== "page" || !Array.isArray(incoming.entry))
    return null;

  const entries: Entry[] = [];
  for (const raw of incoming.entry) {
    if (!raw?.id) continue;
    const entry: Entry = { id: raw.id, time: raw.time ?? Date.now() };
    const changes: NonNullable<Entry["changes"]> = [];
    for (const change of raw.changes ?? []) {
      const value = change.value;
      if (change.field !== "feed" || !value) continue;
      if (value.item !== "comment" || value.verb !== "add") continue;
      if (!value.comment_id || !value.post_id || !value.from?.id) continue;
      changes.push({
        field: "comments",
        value: {
          id: value.comment_id,
          text: value.message ?? "",
          from: { id: value.from.id, username: value.from.name },
          media: { id: value.post_id },
        },
      });
    }
    if (changes.length) entry.changes = changes;
    if (Array.isArray(raw.messaging) && raw.messaging.length)
      entry.messaging = raw.messaging;
    if (entry.changes || entry.messaging) entries.push(entry);
  }

  if (!entries.length) return null;
  return { object: "instagram", entry: entries };
}
