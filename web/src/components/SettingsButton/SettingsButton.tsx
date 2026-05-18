import "./SettingsButton.css";

export function SettingsButton({
  onClick,
  configured,
}: {
  onClick: () => void;
  configured: boolean;
}) {
  return (
    <button
      type="button"
      className={`settings-button${configured ? " configured" : " unconfigured"}`}
      onClick={onClick}
      aria-label={configured ? "Open settings" : "Set up credentials"}
    >
      <span
        className={`settings-dot${configured ? " on" : " off"}`}
        aria-hidden
      />
      <span className="settings-text">
        {configured ? "Settings" : "Set up"}
      </span>
    </button>
  );
}
