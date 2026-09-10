/**
 * Facebook Pages provider: Graph API calls scoped to a Page.
 *
 * A connected Facebook Page is stored as an InstagramAccount row with
 * provider FACEBOOK, `instagramId` = the Page id, and `accessToken` = the
 * Page access token (derived from a long-lived user token, so it does not
 * expire). Everything here mirrors lib/meta/client.ts for Instagram but hits
 * graph.facebook.com with Page ids: comment-to-DM is the Messenger
 * "private reply" (recipient.comment_id), which Meta allows once per
 * comment within 7 days of the comment.
 */
import {
  facebookGraphBase,
  handleResponse,
  type InstagramComment,
  type InstagramMedia,
  type InstagramUser,
  type LinkButton,
} from "@/lib/meta/client";

function authHeaders(accessToken: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
}

type SendResult = { recipient_id: string; message_id: string };

/** Private reply to a Page post comment: one per comment, within 7 days. */
export async function sendPrivateReply(
  accessToken: string,
  pageId: string,
  commentId: string,
  message: string
): Promise<SendResult> {
  const response = await fetch(`${facebookGraphBase()}/${pageId}/messages`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: { text: message },
    }),
  });
  return handleResponse(response);
}

function buttonTemplate(
  text: string,
  buttons: Array<Record<string, string>>
) {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        // Button template text is capped at 640 chars by Meta.
        text: text.slice(0, 640),
        buttons,
      },
    },
  };
}

function toWebUrlButtons(buttons: LinkButton[]) {
  return buttons
    .slice(0, 3)
    .map((b) => ({ type: "web_url", url: b.url, title: b.title.slice(0, 20) }));
}

export async function sendPrivateReplyWithButton(
  accessToken: string,
  pageId: string,
  commentId: string,
  text: string,
  buttonTitle: string,
  payload: string
): Promise<SendResult> {
  const response = await fetch(`${facebookGraphBase()}/${pageId}/messages`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: buttonTemplate(text, [
        { type: "postback", title: buttonTitle.slice(0, 20), payload },
      ]),
    }),
  });
  return handleResponse(response);
}

export async function sendPrivateReplyWithLinkButton(
  accessToken: string,
  pageId: string,
  commentId: string,
  text: string,
  buttons: LinkButton[]
): Promise<SendResult> {
  const response = await fetch(`${facebookGraphBase()}/${pageId}/messages`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: buttonTemplate(text, toWebUrlButtons(buttons)),
    }),
  });
  return handleResponse(response);
}

/**
 * Messages to a Page-scoped user id (PSID) inside the 24-hour window that a
 * private reply's answer or a button tap opens. Messenger requires
 * messaging_type on these, unlike private replies.
 */
export async function sendDirectMessage(
  accessToken: string,
  pageId: string,
  userId: string,
  message: string
): Promise<SendResult> {
  const response = await fetch(`${facebookGraphBase()}/${pageId}/messages`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      messaging_type: "RESPONSE",
      recipient: { id: userId },
      message: { text: message },
    }),
  });
  return handleResponse(response);
}

export async function sendDirectMessageWithButton(
  accessToken: string,
  pageId: string,
  userId: string,
  text: string,
  buttonTitle: string,
  payload: string
): Promise<SendResult> {
  const response = await fetch(`${facebookGraphBase()}/${pageId}/messages`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      messaging_type: "RESPONSE",
      recipient: { id: userId },
      message: buttonTemplate(text, [
        { type: "postback", title: buttonTitle.slice(0, 20), payload },
      ]),
    }),
  });
  return handleResponse(response);
}

export async function sendDirectMessageWithLinkButton(
  accessToken: string,
  pageId: string,
  userId: string,
  text: string,
  buttons: LinkButton[]
): Promise<SendResult> {
  const response = await fetch(`${facebookGraphBase()}/${pageId}/messages`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      messaging_type: "RESPONSE",
      recipient: { id: userId },
      message: buttonTemplate(text, toWebUrlButtons(buttons)),
    }),
  });
  return handleResponse(response);
}

/** Public reply under a Page post comment. Needs pages_manage_engagement. */
export async function sendCommentReply(
  accessToken: string,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  const response = await fetch(`${facebookGraphBase()}/${commentId}/comments`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ message }),
  });
  return handleResponse(response);
}

// --- Reads -----------------------------------------------------------------

interface PagePost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  full_picture?: string;
  attachments?: { data?: Array<{ media_type?: string; type?: string }> };
}

const POST_FIELDS =
  "id,message,created_time,permalink_url,full_picture,attachments{media_type,type}";

function toMedia(post: PagePost): InstagramMedia {
  const attachment = post.attachments?.data?.[0];
  const kind = attachment?.media_type ?? attachment?.type ?? "";
  const media_type =
    kind === "video" || kind === "video_inline" || kind === "video_autoplay"
      ? "VIDEO"
      : kind === "album"
        ? "CAROUSEL_ALBUM"
        : "IMAGE";
  return {
    id: post.id,
    caption: post.message,
    media_type,
    // Reels on Pages show up as video attachments; there is no separate
    // product type in the Page feed, so leave it unset.
    media_url: post.full_picture,
    thumbnail_url: post.full_picture,
    timestamp: post.created_time,
    permalink: post.permalink_url,
  };
}

export async function getPagePosts(
  accessToken: string,
  pageId: string,
  max = 25
): Promise<InstagramMedia[]> {
  const results: InstagramMedia[] = [];
  const first = new URL(`${facebookGraphBase()}/${pageId}/posts`);
  first.searchParams.set("fields", POST_FIELDS);
  first.searchParams.set("limit", String(Math.min(100, max)));
  first.searchParams.set("access_token", accessToken);

  let nextUrl: string | null = first.toString();
  while (nextUrl !== null && results.length < max) {
    const response: Response = await fetch(nextUrl);
    const page = await handleResponse<{
      data: PagePost[];
      paging?: { next?: string };
    }>(response);
    results.push(...(page.data ?? []).map(toMedia));
    nextUrl = page.paging?.next ?? null;
  }
  return results.slice(0, max);
}

interface PageComment {
  id: string;
  message?: string;
  created_time: string;
  from?: { id: string; name?: string };
  comments?: { data?: Array<{ id: string; from?: { id: string; name?: string } }> };
}

function toComment(c: PageComment): InstagramComment {
  return {
    id: c.id,
    text: c.message ?? "",
    timestamp: c.created_time,
    from: c.from ? { id: c.from.id, username: c.from.name } : undefined,
    replies: {
      data: (c.comments?.data ?? []).map((r) => ({
        id: r.id,
        from: r.from ? { id: r.from.id, username: r.from.name } : undefined,
      })),
    },
  };
}

/**
 * Recent comments on a Page post, newest first, with their replies so the
 * reconciler can tell whether the Page already answered. `from` needs
 * pages_read_engagement; comments from people who restrict that are returned
 * without it and are skipped downstream.
 */
export async function getRecentPostComments(
  accessToken: string,
  postId: string,
  sinceMs: number,
  max = 800
): Promise<InstagramComment[]> {
  const results: InstagramComment[] = [];
  const first = new URL(`${facebookGraphBase()}/${postId}/comments`);
  first.searchParams.set("fields", "id,message,created_time,from,comments{from}");
  first.searchParams.set("filter", "stream");
  first.searchParams.set("order", "reverse_chronological");
  first.searchParams.set("limit", "50");
  first.searchParams.set("access_token", accessToken);

  let nextUrl: string | null = first.toString();
  while (nextUrl !== null && results.length < max) {
    const response: Response = await fetch(nextUrl);
    const page = await handleResponse<{
      data: PageComment[];
      paging?: { next?: string };
    }>(response);
    const data = (page.data ?? []).map(toComment);
    results.push(...data);
    const oldest = data[data.length - 1];
    if (oldest?.timestamp && Date.parse(oldest.timestamp) < sinceMs) break;
    nextUrl = page.paging?.next ?? null;
  }
  return results
    .filter((c) => !c.timestamp || Date.parse(c.timestamp) >= sinceMs)
    .slice(0, max);
}

export async function getPageInfo(
  accessToken: string,
  pageId: string
): Promise<InstagramUser> {
  const url = new URL(`${facebookGraphBase()}/${pageId}`);
  url.searchParams.set("fields", "id,name,username,fan_count,picture{url}");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url.toString());
  const page = await handleResponse<{
    id: string;
    name: string;
    username?: string;
    fan_count?: number;
    picture?: { data?: { url?: string } };
  }>(response);
  return {
    id: page.id,
    user_id: page.id,
    username: page.username ?? page.name,
    name: page.name,
    profile_picture_url: page.picture?.data?.url,
    followers_count: page.fan_count,
  };
}

/**
 * Subscribe the app to this Page's webhooks. `feed` carries post comments,
 * the messaging fields carry Messenger replies, button taps, and reads.
 */
export async function subscribePageToWebhooks(
  pageId: string,
  pageAccessToken: string
): Promise<{ success: boolean }> {
  const response = await fetch(
    `${facebookGraphBase()}/${pageId}/subscribed_apps`,
    {
      method: "POST",
      headers: authHeaders(pageAccessToken),
      body: JSON.stringify({
        subscribed_fields: [
          "feed",
          "messages",
          "messaging_postbacks",
          "message_reads",
        ],
      }),
    }
  );
  return handleResponse(response);
}

// --- Messenger inbox (Conversations API) ----------------------------------

export async function getPageConversations(accessToken: string, pageId: string) {
  const url = new URL(`${facebookGraphBase()}/${pageId}/conversations`);
  url.searchParams.set("platform", "messenger");
  url.searchParams.set(
    "fields",
    "participants,updated_time,messages.limit(1){message,from,created_time}"
  );
  url.searchParams.set("limit", "50");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url.toString());
  const data = await handleResponse<{
    data: Array<{
      id: string;
      updated_time?: string;
      participants?: { data: Array<{ id: string; name?: string }> };
      messages?: {
        data: Array<{
          id: string;
          message?: string;
          created_time?: string;
          from?: { id: string; name?: string };
        }>;
      };
    }>;
  }>(response);
  return (data.data ?? []).map((c) => ({
    id: c.id,
    updated_time: c.updated_time,
    participants: {
      data: (c.participants?.data ?? []).map((p) => ({
        id: p.id,
        username: p.name,
      })),
    },
    messages: c.messages
      ? {
          data: c.messages.data.map((m) => ({
            id: m.id,
            message: m.message,
            created_time: m.created_time,
            from: m.from ? { id: m.from.id, username: m.from.name } : undefined,
          })),
        }
      : undefined,
  }));
}

export async function getPageConversationMessages(
  accessToken: string,
  conversationId: string
) {
  const url = new URL(`${facebookGraphBase()}/${conversationId}`);
  url.searchParams.set("fields", "messages{id,created_time,from,to,message}");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url.toString());
  const data = await handleResponse<{
    messages?: {
      data: Array<{
        id: string;
        created_time?: string;
        message?: string;
        from?: { id: string; name?: string };
        to?: { data: Array<{ id: string; name?: string }> };
      }>;
    };
  }>(response);
  return (data.messages?.data ?? []).map((m) => ({
    id: m.id,
    created_time: m.created_time,
    message: m.message,
    from: m.from ? { id: m.from.id, username: m.from.name } : undefined,
    to: m.to
      ? { data: m.to.data.map((p) => ({ id: p.id, username: p.name })) }
      : undefined,
  }));
}
