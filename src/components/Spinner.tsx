interface Props {
  /** What's loading, e.g. "Loading commits". Shown on hover and read by screen readers. */
  label: string;
  size?: number;
  /** Milliseconds before the spinner fades in, so quick loads show nothing. */
  delay?: number;
}

export function Spinner({ label, size = 14, delay = 400 }: Props) {
  return <span className="spinner" style={{ width: size, height: size, animationDelay: `0ms, ${delay}ms` }} role="status" aria-label={label} title={label} />;
}
