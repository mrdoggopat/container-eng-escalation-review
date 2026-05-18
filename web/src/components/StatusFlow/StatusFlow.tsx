import "./StatusFlow.css";

export function StatusFlow({ flow }: { flow: string }) {
  const steps = flow.split("→").map((s) => s.trim());
  return (
    <div className="status-flow">
      {steps.map((step, idx) => (
        <span key={idx} className="status-step-wrap">
          <span className="status-step">{step}</span>
          {idx < steps.length - 1 ? (
            <span className="status-arrow" aria-hidden>
              →
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
