import { describe, expect, it } from "vitest";
import { normalizeFacebookEvent } from "@/lib/facebook/normalize-event";
import {
  parseCommentEvents,
  parseMessageEvents,
  parsePostbackEvents,
  parseReadEvents,
} from "@/lib/meta/webhook";

const feedComment = (overrides: Record<string, unknown> = {}) => ({
  object: "page",
  entry: [
    {
      id: "page1",
      time: 1_700_000_000,
      changes: [
        {
          field: "feed",
          value: {
            item: "comment",
            verb: "add",
            comment_id: "post1_c1",
            post_id: "page1_post1",
            parent_id: "page1_post1",
            message: "LINK please",
            from: { id: "user1", name: "Jane Doe" },
            created_time: 1_700_000_000,
            ...overrides,
          },
        },
      ],
    },
  ],
});

describe("Facebook Page event boundary", () => {
  it("maps a new feed comment onto the Instagram comment shape", () => {
    const result = normalizeFacebookEvent(feedComment());
    expect(result?.object).toBe("instagram");
    expect(parseCommentEvents(result!)).toEqual([
      {
        instagramAccountId: "page1",
        commentId: "post1_c1",
        commentText: "LINK please",
        commenterId: "user1",
        commenterName: "Jane Doe",
        mediaId: "page1_post1",
        originalMediaId: undefined,
      },
    ]);
  });

  it("drops feed items that are not new comments", () => {
    expect(normalizeFacebookEvent(feedComment({ verb: "edited" }))).toBeNull();
    expect(normalizeFacebookEvent(feedComment({ verb: "remove" }))).toBeNull();
    expect(normalizeFacebookEvent(feedComment({ item: "reaction" }))).toBeNull();
    expect(normalizeFacebookEvent(feedComment({ from: undefined }))).toBeNull();
  });

  it("lets the shared parser drop the Page's own comments", () => {
    const result = normalizeFacebookEvent(feedComment({ from: { id: "page1", name: "Page" } }));
    expect(parseCommentEvents(result!)).toEqual([]);
  });

  it("ignores non-page objects and empty payloads", () => {
    expect(normalizeFacebookEvent({ object: "instagram", entry: [] })).toBeNull();
    expect(normalizeFacebookEvent(null)).toBeNull();
    expect(normalizeFacebookEvent({ object: "page", entry: [{ id: "page1", changes: [] }] })).toBeNull();
  });

  it("passes Messenger messages, postbacks, and reads through", () => {
    const payload = {
      object: "page",
      entry: [
        {
          id: "page1",
          time: 1,
          messaging: [
            { sender: { id: "psid1" }, recipient: { id: "page1" }, message: { mid: "m1", text: "LINK" } },
            { sender: { id: "psid1" }, recipient: { id: "page1" }, postback: { mid: "m2", payload: "reveal:c1" } },
            { sender: { id: "psid1" }, recipient: { id: "page1" }, read: { watermark: 5 } },
            { sender: { id: "page1" }, recipient: { id: "psid1" }, message: { mid: "m3", text: "echo", is_echo: true } },
          ],
        },
      ],
    };
    const result = normalizeFacebookEvent(payload)!;
    expect(parseMessageEvents(result)).toEqual([
      { instagramAccountId: "page1", messageId: "m1", messageText: "LINK", senderId: "psid1" },
    ]);
    expect(parsePostbackEvents(result)).toEqual([
      { instagramAccountId: "page1", userId: "psid1", payload: "reveal:c1", mid: "m2" },
    ]);
    expect(parseReadEvents(result)).toEqual([
      { instagramAccountId: "page1", userId: "psid1", watermark: 5 },
    ]);
  });
});
