import { Fragment } from "react";
import "./StepProgress.css";

type Step = 1 | 2 | 3;

const STEPS: { num: Step; label: string }[] = [
  { num: 1, label: "Timeframe" },
  { num: 2, label: "Query" },
  { num: 3, label: "Review" },
];

export function StepProgress({ current }: { current: Step }) {
  return (
    <div className="step-progress" aria-label={`Step ${current} of 3`}>
      {STEPS.map((s, i) => {
        const isCurrent = s.num === current;
        const isDone = s.num < current;
        const dotClass =
          "step-dot" +
          (isCurrent ? " current" : "") +
          (isDone ? " done" : "");
        return (
          <Fragment key={s.num}>
            <div className={dotClass}>
              <span className="step-dot-num">{isDone ? "✓" : s.num}</span>
              <span className="step-dot-label">{s.label}</span>
            </div>
            {i < STEPS.length - 1 ? (
              <div className={`step-connector${isDone ? " done" : ""}`} />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
