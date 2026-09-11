import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { canConnectInstagramAccount } from "@/lib/instagram-accounts";
import { subscribePageToWebhooks } from "@/lib/facebook/client";
import {
  exchangeFacebookCode,
  getLongLivedUserToken,
  inspectUserToken,
  listUserPages,
  rawUserAccounts,
} from "@/lib/facebook/oauth";
import { encryptToken, verifyOAuthState } from "@/lib/meta/oauth";
import { canManageWorkspace } from "@/lib/workspace-access";

// A Facebook login can expose many Pages. Connect the ones the user manages,
// up to this cap; extras can be disconnected from Settings.
const MAX_PAGES_PER_CONNECT = 10;

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = verifyOAuthState(request.nextUrl.searchParams.get("state"));
  const baseUrl = getBaseUrl();

  if (error) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=denied`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=invalid`);
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(`${baseUrl}/login`);
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: state.workspaceId, userId: session.user.id },
  });
  if (!membership || !canManageWorkspace(membership.role)) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=forbidden`);
  }

  try {
    const redirectUri = `${baseUrl}/api/facebook/callback`;
    const { accessToken: shortLived } = await exchangeFacebookCode(code, redirectUri);
    const { accessToken: userToken } = await getLongLivedUserToken(shortLived);
    const pages = await listUserPages(userToken);

    if (pages.length === 0) {
      // An empty /me/accounts looks identical whether the user really manages
      // no Pages or the token is missing a grant, so record what the token
      // actually carries before sending them back with a one-word reason.
      const [token, accounts] = await Promise.all([
        inspectUserToken(userToken).catch((e: unknown) => ({
          diagnosticError: e instanceof Error ? e.message : String(e),
        })),
        rawUserAccounts(userToken).catch((e: unknown) => ({
          diagnosticError: e instanceof Error ? e.message : String(e),
        })),
      ]);
      await prisma.operationalEvent
        .create({
          data: {
            source: "SYSTEM",
            level: "WARNING",
            workspaceId: state.workspaceId,
            message: "Facebook connect returned no Pages",
            payload: { token, accounts } as never,
          },
        })
        .catch(() => {});
      return NextResponse.redirect(`${baseUrl}/settings?facebook=no_pages`);
    }

    let connected = 0;
    let skipped = 0;
    for (const page of pages.slice(0, MAX_PAGES_PER_CONNECT)) {
      const allowed = await canConnectInstagramAccount({
        workspaceId: state.workspaceId,
        instagramId: page.id,
        provider: "FACEBOOK",
      });
      if (!allowed.allowed) {
        skipped += 1;
        continue;
      }

      let webhookSubscribed = false;
      try {
        const subscription = await subscribePageToWebhooks(page.id, page.accessToken);
        webhookSubscribed = Boolean(subscription.success);
      } catch (subscriptionError) {
        console.warn("[Facebook Callback] Page webhook subscription failed:", subscriptionError);
      }

      const data = {
        username: page.username ?? page.name,
        name: page.name,
        accessToken: encryptToken(page.accessToken),
        // Page tokens minted from a long-lived user token do not expire.
        tokenExpiresAt: null,
        webhookSubscribed,
      };
      const existing = await prisma.instagramAccount.findUnique({
        where: { instagramId: page.id },
      });
      if (existing) {
        await prisma.instagramAccount.updateMany({
          where: { id: existing.id, workspaceId: state.workspaceId, provider: "FACEBOOK" },
          data,
        });
      } else {
        await prisma.instagramAccount.create({
          data: {
            ...data,
            workspaceId: state.workspaceId,
            instagramId: page.id,
            provider: "FACEBOOK",
          },
        });
      }
      connected += 1;
    }

    if (connected === 0) {
      return NextResponse.redirect(`${baseUrl}/settings?facebook=already_connected`);
    }
    return NextResponse.redirect(
      `${baseUrl}/dashboard?connected=true&facebook=${connected}${skipped ? `&skipped=${skipped}` : ""}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Facebook Callback] Error:", err);
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "ERROR",
          workspaceId: state.workspaceId,
          message: "Facebook Page connection failed",
          payload: { reason: message },
        },
      })
      .catch(() => {});
    return NextResponse.redirect(
      `${baseUrl}/settings?facebook=failed&reason=${encodeURIComponent(message.slice(0, 200))}`
    );
  }
}
