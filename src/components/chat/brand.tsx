export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
