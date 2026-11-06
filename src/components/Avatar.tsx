export function Avatar({ src, size = 20, login }: { src?: string | null; size?: number; login?: string }) {
  // Without a source, an img shows a broken-image icon and its alt text.
  if (!src) return <span className="avatar" style={{ display: "inline-block", width: size, height: size }} aria-hidden="true" />;
  const url = withSize(src, size * 2);
  return <img className="avatar" src={url} width={size} height={size} alt={login ? `@${login}` : ""} loading="lazy" decoding="async" />;
}

function withSize(src: string, px: number): string {
  if (!src.includes("avatars.githubusercontent.com")) return src;
  try {
    const u = new URL(src);
    u.searchParams.set("s", String(px));
    return u.toString();
  } catch {
    return src;
  }
}
