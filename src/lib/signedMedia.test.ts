import { describe, expect, it } from "vitest";
import { attachmentUrl, isSignedMedia, signedExpiry } from "./signedMedia";

const jwt = (payload: object) => `eyJ0eXAiOiJKV1QifQ.${btoa(JSON.stringify(payload)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.sig`;
const signed = (payload: object) =>
  `https://private-user-images.githubusercontent.com/42805582/696698705-ce5dda1d-4fce-4d92-8256-ab729dd8d60a.png?jwt=${jwt(payload)}`;

describe("signedMedia", () => {
  it("reads the expiry from the JWT", () => {
    expect(signedExpiry(signed({ exp: 1794003201, path: "/x?y=1" }))).toBe(1794003201000);
  });

  it("returns 0 for other URLs and bad tokens", () => {
    expect(signedExpiry("https://user-images.githubusercontent.com/1/abc.png")).toBe(0);
    expect(signedExpiry("https://private-user-images.githubusercontent.com/1/2-ce5dda1d-4fce-4d92-8256-ab729dd8d60a.png?jwt=bad")).toBe(0);
  });

  it("maps a signed URL to its permanent attachment URL", () => {
    expect(isSignedMedia(signed({ exp: 1 }))).toBe(true);
    expect(attachmentUrl(signed({ exp: 1 }))).toBe("https://github.com/user-attachments/assets/ce5dda1d-4fce-4d92-8256-ab729dd8d60a");
    expect(attachmentUrl("https://example.com/a.png")).toBeUndefined();
  });
});
