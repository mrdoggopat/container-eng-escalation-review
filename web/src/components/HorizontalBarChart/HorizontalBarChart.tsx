import type { EscalationCard } from "../../lib/data";
import "./HorizontalBarChart.css";

export function HorizontalBarChart({ cards }: { cards: EscalationCard[] }) {
  const sorted = [...cards].sort((a, b) => b.durationDays - a.durationDays);
  const max = Math.max(...sorted.map((c) => c.durationDays), 1);
  return (
    <div className="bar-chart">
      {sorted.map((card) => {
        const pct = (card.durationDays / max) * 100;
        return (
          <div className="bar-row" key={card.id}>
            <a
              className="bar-label"
              href={`https://datadoghq.atlassian.net/browse/${card.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {card.id}
            </a>
            <div className="bar-track">
              <div
                className={`bar-fill ${card.preventable ? "tone-warning" : "tone-info"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="bar-value">{card.durationDays}d</div>
          </div>
        );
      })}
      <div className="bar-legend">
        <span className="legend-item">
          <span className="legend-swatch tone-info" /> Not preventable
        </span>
        <span className="legend-item">
          <span className="legend-swatch tone-warning" /> Preventable
        </span>
      </div>
    </div>
  );
}
