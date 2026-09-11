/**
 * Facebook Login for the Pages provider. The state signing and token
 * encryption are shared with the Instagram flow (lib/meta/oauth.ts); only the
 * authorize host, the token exchange, and the Page listing differ.
 */
import { getMetaGraphApiVersion, requireEnv } from "@/lib/env";
import { facebookGraphBase, handleResponse } from "@/lib/meta/client";

export const FACEBOOK_PAGE_SCOPES = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_manage_engagement",
  // Reading comments (text + who wrote them) on Page posts.
  "pages_read_user_content",
  "pages_messaging",
];

export function getFacebookAuthorizationUrl(
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: requireEnv("FACEBOOK_APP_ID"),
    redirect_uri: redirectUri,
    scope: FACEBOOK_PAGE_SCOPES.join(","),
    response_type: "code",
    state,
  });
  return `https://www.facebook.com/${getMetaGraphApiVersion()}/dialog/oauth?${params}`;
}

export async function exchangeFacebookCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string }> {
  const url = new URL(`${facebookGraphBase()}/oauth/access_token`);
  url.searchParams.set("client_id", requireEnv("FACEBOOK_APP_ID"));
  url.searchParams.set("client_secret", requireEnv("FACEBOOK_APP_SECRET"));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);
  const response = await fetch(url.toString());
  const data = await handleResponse<{ access_token: string }>(response);
  return { accessToken: data.access_token };
}

/**
 * Long-lived user token (~60 days). Page tokens minted from it do not expire,
 * which is why the refresh cron leaves FACEBOOK accounts alone.
 */
export async function getLongLivedUserToken(
  shortLivedToken: string
): Promise<{ accessToken: string }> {
  const url = new URL(`${facebookGraphBase()}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", requireEnv("FACEBOOK_APP_ID"));
  url.searchParams.set("client_secret", requireEnv("FACEBOOK_APP_SECRET"));
  url.searchParams.set("fb_exchange_token", shortLivedToken);
  const response = await fetch(url.toString());
  const data = await handleResponse<{ access_token: string }>(response);
  return { accessToken: data.access_token };
}

export interface FacebookPage {
  id: string;
  name: string;
  username?: string;
  accessToken: string;
}

/** Pages the user manages, each with its own Page access token. */
export async function listUserPages(userToken: string): Promise<FacebookPage[]> {
  const url = new URL(`${facebookGraphBase()}/me/accounts`);
  url.searchParams.set("fields", "id,name,username,access_token");
  url.searchParams.set("limit", "50");
  url.searchParams.set("access_token", userToken);
  const response = await fetch(url.toString());
  const data = await handleResponse<{
    data: Array<{ id: string; name: string; username?: string; access_token: string }>;
  }>(response);
  return (data.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    username: p.username,
    accessToken: p.access_token,
  }));
}

/**
 * Diagnostics for a connect that returned no Pages. `/me/accounts` answering
 * with an empty list is indistinguishable from a permission problem at the
 * call site, so capture what the token actually carries (granted scopes, the
 * app and user it belongs to) alongside the raw edge response.
 */
export async function inspectUserToken(userToken: string): Promise<unknown> {
  const url = new URL(`${facebookGraphBase()}/debug_token`);
  url.searchParams.set("input_token", userToken);
  url.searchParams.set(
    "access_token",
    `${requireEnv("FACEBOOK_APP_ID")}|${requireEnv("FACEBOOK_APP_SECRET")}`
  );
  const response = await fetch(url.toString());
  return response.json();
}

export async function rawUserAccounts(userToken: string): Promise<unknown> {
  const url = new URL(`${facebookGraphBase()}/me/accounts`);
  url.searchParams.set("fields", "id,name,username,tasks");
  url.searchParams.set("limit", "50");
  url.searchParams.set("access_token", userToken);
  const response = await fetch(url.toString());
  return response.json();
}
