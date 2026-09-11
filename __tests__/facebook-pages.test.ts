import { describe, expect, it } from "vitest";
import { pageIdsFromDebugToken } from "@/lib/facebook/oauth";

describe("Login for Business page discovery", () => {
  it("collects every Page id bound to the token's granular scopes", () => {
    const debug = {
      data: {
        type: "USER",
        is_valid: true,
        scopes: ["pages_show_list", "pages_messaging"],
        granular_scopes: [
          { scope: "pages_show_list", target_ids: ["747367192128595"] },
          { scope: "pages_messaging", target_ids: ["747367192128595"] },
          { scope: "pages_read_engagement", target_ids: ["747367192128595", "999"] },
        ],
      },
    };
    expect(pageIdsFromDebugToken(debug).sort()).toEqual(["747367192128595", "999"]);
  });

  it("returns nothing for a classic token, so the accounts edge stays in play", () => {
    expect(pageIdsFromDebugToken({ data: { scopes: ["pages_show_list"] } })).toEqual([]);
    expect(pageIdsFromDebugToken({})).toEqual([]);
    expect(pageIdsFromDebugToken(null)).toEqual([]);
    expect(pageIdsFromDebugToken({ data: { granular_scopes: [{ scope: "email" }] } })).toEqual([]);
  });
})
