export function LandingPage({
  onGetStarted,
  onPreview,
  credentialsConfigured,
  projectKey,
}: {
  onGetStarted: () => void;
  onPreview: () => void;
  credentialsConfigured: boolean;
  projectKey: string;
}) {
  return (
    <div className="landing-page">
      <section className="landing-hero">
        <span className="landing-tag">Engineering escalation workflow</span>
        <h1 className="landing-title">Escalation to Engineering Review</h1>
        <p className="landing-tagline">
          Review escalated Jira cards for any window of time. Pull them straight from
          Jira, summarize each card with Claude, and surface what could have been
          prevented.
        </p>
        <div className="landing-cta-row">
          <button
            type="button"
            className="primary-button landing-cta"
            onClick={onGetStarted}
            autoFocus
          >
            Get started →
          </button>
          <button
            type="button"
            className="ghost-button landing-cta-secondary"
            onClick={onPreview}
          >
            See a sample report
          </button>
          <span className="muted small">
            {credentialsConfigured
              ? `Configured for ${projectKey} · jumps straight to your dashboard`
              : "Takes ~1 minute to connect Jira and Anthropic"}
          </span>
        </div>
      </section>

      <section className="landing-steps">
        <h3 className="section-title">How it works</h3>
        <ol className="landing-steps-list">
          <li>
            <span className="landing-step-num">1</span>
            <div>
              <div className="landing-step-title">Connect Jira and Anthropic</div>
              <p className="muted">
                Credentials are stored locally on this device — never sent anywhere
                else.
              </p>
            </div>
          </li>
          <li>
            <span className="landing-step-num">2</span>
            <div>
              <div className="landing-step-title">Pick what to do</div>
              <p className="muted">
                Generate a fresh report from Jira, import a previously exported file, or
                compare timeframes side-by-side.
              </p>
            </div>
          </li>
          <li>
            <span className="landing-step-num">3</span>
            <div>
              <div className="landing-step-title">Review the report</div>
              <p className="muted">
                Per-card analysis, preventability flags, and export to Markdown, CSV,
                or JSON.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <p className="landing-footnote muted small">
        Defaults are wired for the Datadog Containers (CONS) Jira project. Other teams
        can override the project key, escalation columns, and team roster in the
        credentials screen.
      </p>
    </div>
  );
}
