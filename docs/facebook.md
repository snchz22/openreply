# Facebook Pages

Comment-to-DM on Facebook Page posts, using the same campaigns, keywords, links, logs, and worker as Instagram. A connected Page is stored as an account with provider `FACEBOOK`; the Page id takes the place of the Instagram id and the Page access token (which does not expire) takes the place of the Instagram token.

## How it maps onto the Instagram pipeline

| Instagram | Facebook Page |
| --- | --- |
| Instagram Login (`/api/instagram/connect`) | Facebook Login (`/api/facebook/connect`), lists the Pages the user manages and connects each one |
| `comments` webhook field on the IG account | `feed` webhook field on the Page (`item: comment`, `verb: add`), normalized by `lib/facebook/normalize-event.ts` |
| Private reply `POST /{ig_id}/messages` with `recipient.comment_id` | Same call on `graph.facebook.com/{page_id}/messages` |
| DM after a button tap (`recipient.id`) | Same, plus `messaging_type: RESPONSE` |
| Public comment reply `POST /{comment_id}/replies` | `POST /{comment_id}/comments` |
| Post picker via `/me/media` | `/{page_id}/posts` |
| Follow gate via `is_user_follow_business` | Not available on Messenger; the gate fails open (only a definite "no" prompts) |

Meta's rules for Page private replies: one per comment, sent within 7 days of the comment. If the person replies, the standard 24-hour messaging window opens.

## Meta app configuration

Same app as Instagram. In the developer console:

1. **App settings, Basic**: note the App ID (`FACEBOOK_APP_ID`) and App secret (`FACEBOOK_APP_SECRET`, already required for webhook signatures).
2. **Facebook Login for Business, Settings**: add `https://<your-domain>/api/facebook/callback` to Valid OAuth Redirect URIs.
3. **Webhooks**: on the **Page** object, set the same callback URL and verify token as Instagram, then subscribe `feed`, `messages`, `messaging_postbacks`, `message_reads`.
4. **Permissions**: `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `pages_manage_engagement`, `pages_messaging`. Standard Access covers Pages administered by people who hold a role on the app; add the Page admin's Facebook account under App roles.

## Environment

```
FACEBOOK_APP_ID=<Meta App ID>
FACEBOOK_APP_SECRET=<App secret>
```

## Connect and test

1. Settings, **Connect a Facebook Page**. Log in as a Page admin who has a role on the app. Every managed Page (up to 10) is connected; disconnect the ones you do not want.
2. Create a campaign on the Page account like any other. The post picker lists Page posts.
3. Comment the keyword on a Page post from a different Facebook account. The DM Logs page shows the send.

Known limits: no per-post insights or follower history for Pages, and Page reels appear as video posts.
