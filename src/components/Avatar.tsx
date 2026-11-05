export function Avatar({ src, size = 20, login }: { src?: string | null; size?: number; login?: string }) {
  const url = src ? withSize(src, size * 2) : undefined;
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
