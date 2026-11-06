/** Uploaded attachment links, signed with a short-lived JWT in the `jwt` parameter. */
const SIGNED = /^https:\/\/private-user-images\.githubusercontent\.com\/\d+\/\d+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.\w+\?/;

export function isSignedMedia(url: string): boolean {
  return SIGNED.test(url);
}

/** When a signed attachment URL expires, in ms since the epoch; 0 for other or unreadable URLs. */
export function signedExpiry(url: string): number {
  if (!isSignedMedia(url)) return 0;
  try {
    const payload = new URL(url).searchParams.get("jwt")?.split(".")[1];
    if (!payload) return 0;
    const exp = (JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** The attachment's permanent github.com URL, which signs a fresh link for a signed-in visitor. */
export function attachmentUrl(url: string): string | undefined {
  const uuid = SIGNED.exec(url)?.[1];
  return uuid && `https://github.com/user-attachments/assets/${uuid}`;
}
