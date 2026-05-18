import "./Stat.css";

export function Stat({
  value,
  label,
  tone,
}: {
  value: React.ReactNode;
  label: string;
  tone?: "warning" | "danger" | "success" | "info";
}) {
  return (
    <div className="stat">
      <div className={`stat-value${tone ? ` tone-${tone}` : ""}`}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
