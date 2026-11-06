interface Props {
  /** What's loading, e.g. "Loading commits". Shown on hover and read by screen readers. */
  label: string;
  size?: number;
  /** Milliseconds before the spinner fades in, so quick loads show nothing. */
  delay?: number;
  /** False hides the spinner but keeps its space, so content beside it stays put when loading starts or stops. */
  show?: boolean;
}

export function Spinner({ label, size = 14, delay = 400, show = true }: Props) {
  if (!show) return <span className="spinner idle" style={{ width: size, height: size }} aria-hidden="true" />;
  return <span className="spinner" style={{ width: size, height: size, animationDelay: `0ms, ${delay}ms` }} role="status" aria-label={label} title={label} />;
}
