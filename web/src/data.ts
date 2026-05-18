export type SolutionCategory =
  | "PR fix"
  | "Customer environment specific issue"
  | "Suggestion without PR or code fixes"
  | "Other";

/**
 * Free-form column-name string (or comma-joined combination) describing which
 * escalation columns a card's status history touched.
 */
export type EscalationKind = string;

export type EscalationCard = {
  id: string;
  title: string;
  summary: string;
  escalationReason: string;
  /** ISO date (yyyy-mm-dd) when the card was created. */
  createdAt: string;
  /** ISO date (yyyy-mm-dd) when the card first transitioned to Done / Archive. */
  resolvedAt: string;
  durationDays: number;
  assignee: string;
  reporter: string;
  statusFlow: string;
  preventable: boolean;
  preventableReason: string;
  solutionCategory: SolutionCategory;
  escalationKind: EscalationKind;
  nonTeeInvolvement: string;
  improvement: string;
};

export type ReportPeriod = {
  label: string;
  rangeStart: string;
  rangeEnd: string;
  totalCardsCreated: number;
  cards: EscalationCard[];
  improvements: { title: string; body: string }[];
};

export const MARCH_2026: ReportPeriod = {
  label: "March 2026",
  rangeStart: "2026-03-01",
  rangeEnd: "2026-03-31",
  totalCardsCreated: 55,
  cards: [
    {
      id: "CONS-8086",
      title: "Increasing memory usage for CCR running SQL Server",
      summary:
        "Cluster check runners running SQL Server checks alongside KSM Core were OOMing. Investigation revealed KSM Core's large label set from SQL Server pods caused the high memory usage.",
      escalationReason:
        "Performance / memory regression — intermittent OOM restarts across multiple CCRs.",
      createdAt: "2026-02-12",
      resolvedAt: "2026-03-13",
      durationDays: 29,
      assignee: "Mathieu Colin",
      reporter: "Sean Kornatowski",
      statusFlow:
        "TEE Triage → TEE - In Progress → Waiting for TSE → Engineering Triage → Engineering - In Progress → Waiting for TSE → Done → Archive",
      preventable: true,
      preventableReason:
        "Alexandre Lavigne (engineering) commented with the root cause (KSM Core tag processing from SQL Server labels) on Mar 6, the same day as escalation. Could likely have been obtained via Slack consult with the Agent/KSM team without a formal escalation.",
      solutionCategory: "Suggestion without PR or code fixes",
      escalationKind: "Both Engineering Triage + In Progress",
      nonTeeInvolvement:
        "Binita Poudel (TSE relay) shared flares and customer updates. Alexandre Lavigne (engineering) identified KSM Core label processing as the root cause.",
      improvement:
        "A Slack channel pattern or internal KB entry covering CCR + KSM Core memory interactions could enable TEE to resolve such cases without formal escalation.",
    },
    {
      id: "CONS-8117",
      title: "Container crash with Datadog APM (Windows 2025, .NET, ECS)",
      summary:
        "Docker Daemon on Windows 2025 crashed with a Go runtime double-panic when the Datadog agent was enabled. Engineering determined the agent triggered a code path in an older Docker version. Customer resolved by upgrading Docker.",
      escalationReason:
        "Bug / compatibility — production crashes caused by Datadog agent on Windows 2025 + .NET ECS tasks.",
      createdAt: "2026-02-24",
      resolvedAt: "2026-03-09",
      durationDays: 13,
      assignee: "Alexandre Lavigne",
      reporter: "Hassan Albujasim",
      statusFlow:
        "TEE - In Progress → Waiting for TSE (×many) → Engineering Triage → Engineering - In Progress → Waiting for TSE → Done → Archive",
      preventable: false,
      preventableReason:
        "Required deep Go runtime / Docker internals investigation; engineering diagnosed a double-panic in the Docker GC triggered by the agent and consulted the Windows Products team.",
      solutionCategory: "Customer environment specific issue",
      escalationKind: "Both Engineering Triage + In Progress",
      nonTeeInvolvement:
        "Yiyuan Geng (TSE relay) covered while the reporter was out. Alexandre Lavigne (engineering) led the technical investigation across 10 comments.",
      improvement:
        "A Windows agent compatibility matrix (agent × Docker × Windows OS) would help TEE triage faster without needing engineering consultation.",
    },
    {
      id: "CONS-8150",
      title:
        "APM auto-instrumentation enabledNamespaces caused cluster-wide pod scheduling outage",
      summary:
        "Enabling APM auto-instrumentation with enabledNamespaces triggered a cluster-wide pod scheduling outage. The customer's own PR modified Cluster Agent code, prompting escalation for engineering review.",
      escalationReason:
        "Production outage / customer PR touching Cluster Agent code.",
      createdAt: "2026-03-05",
      resolvedAt: "2026-03-13",
      durationDays: 8,
      assignee: "Gabriel Dos Santos",
      reporter: "Juliana Almeida",
      statusFlow:
        "TEE Triage → TEE - In Progress → Waiting for TSE → Engineering Triage → Waiting for TSE → TEE - In Progress → Waiting for TSE → Done → Archive",
      preventable: false,
      preventableReason:
        "Venus Parfait (TSE) explicitly requested engineering review because the customer was modifying Cluster Agent code. That review was appropriate.",
      solutionCategory: "Customer environment specific issue",
      escalationKind: "Engineering Triage",
      nonTeeInvolvement:
        "Venus Parfait (TSE) identified a customer PR modifying Cluster Agent code and escalated accordingly.",
      improvement:
        "Better documentation of enabledNamespaces behavior and known failure modes would reduce time-to-diagnosis.",
    },
    {
      id: "CONS-8152",
      title: "Kubernetes events missing consistently in EKS",
      summary:
        "Kubernetes events were missing intermittently in an EKS environment. Engineering identified an 8-minute gap between check runs as likely root cause; the issue appeared related to CLC scheduling or Kubernetes API latency under load.",
      escalationReason:
        "Bug / data gap — events systematically absent from EKS monitoring.",
      createdAt: "2026-03-08",
      resolvedAt: "2026-03-28",
      durationDays: 20,
      assignee: "Akira Hiiro",
      reporter: "Lifeng Tian",
      statusFlow:
        "TEE Triage → Waiting for TSE → TEE - In Progress → Engineering Triage → TEE - In Progress → Waiting for TSE → Engineering Triage → Waiting for TSE → TEE - In Progress → Waiting for TSE → Done → Archive",
      preventable: false,
      preventableReason:
        "Escalated twice to Engineering Triage; Gabriel Dos Santos (engineering) was needed to analyze the 8-minute gap pattern between check runs.",
      solutionCategory: "Customer environment specific issue",
      escalationKind: "Engineering Triage",
      nonTeeInvolvement:
        "Gabriel Dos Santos (engineering) provided analysis of the 8-minute gap between check runs and recommended configuration adjustments.",
      improvement:
        "Document expected event collection cadence and known EKS API latency thresholds so TEE can identify gap-related issues earlier.",
    },
    {
      id: "CONS-8154",
      title:
        "GKE Autopilot Helm deployment blocked by autogke-no-write-mode-hostpath",
      summary:
        "GKE Autopilot's autogke-no-write-mode-hostpath WorkloadAllowlist policy blocked the Datadog Helm deployment. A known GKE Autopilot limitation with specific Helm values workaround.",
      escalationReason:
        "Feature limitation — GKE Autopilot WorkloadAllowlist incompatibility with default Helm chart values.",
      createdAt: "2026-03-10",
      resolvedAt: "2026-03-12",
      durationDays: 2,
      assignee: "Patrick Liang",
      reporter: "Vince Allen",
      statusFlow:
        "TEE Triage → TEE - In Progress → Waiting for TSE → Engineering Triage → Waiting for TSE → Done → Archive",
      preventable: true,
      preventableReason:
        "Patrick Liang (TEE) resolved this within 2 days with no engineering input. The Engineering Triage step was unnecessary — this is a documented GKE Autopilot limitation that TEE can handle with existing runbooks.",
      solutionCategory: "Suggestion without PR or code fixes",
      escalationKind: "Engineering Triage",
      nonTeeInvolvement: "None.",
      improvement:
        "Add a GKE Autopilot runbook to the TEE knowledge base so this class of issue is resolved without touching Engineering Triage.",
    },
    {
      id: "CONS-8157",
      title: "Metric discrepancy when app container sends to a Datadog sidecar",
      summary:
        "Customer observed metric count discrepancies when an application container sends metrics to a Datadog sidecar vs. host-level DogStatsD. Escalated to PM Triage to determine intended behavior.",
      escalationReason:
        "Product behavior ambiguity / potential feature gap — sidecar container metric aggregation behavior unclear.",
      createdAt: "2026-03-11",
      resolvedAt: "2026-04-10",
      durationDays: 30,
      assignee: "Patrick Liang",
      reporter: "Devi Shyam",
      statusFlow:
        "TEE Triage → TEE - In Progress → Waiting for TSE → TEE - In Progress → PM Triage → Waiting for TSE → TEE - In Progress → Waiting for TSE → Done → Archive",
      preventable: false,
      preventableReason:
        "PM Triage was the correct escalation path; a product decision was required. The long duration reflects customer back-and-forth.",
      solutionCategory: "Suggestion without PR or code fixes",
      escalationKind: "PM Triage",
      nonTeeInvolvement: "None.",
      improvement:
        "Document sidecar DogStatsD metric aggregation semantics so TSEs can self-serve common questions about metric discrepancies.",
    },
    {
      id: "CONS-8159",
      title:
        "Datadog APM causing deployment failure when Istio sidecar enabled (EKS)",
      summary:
        "APM auto-instrumentation (SSI) caused pod deployment failures in EKS with Istio sidecar injection. The issue involved readiness probe timing conflicts between the Istio sidecar and instrumented pods.",
      escalationReason:
        "Compatibility — APM SSI + Istio sidecar readiness probe conflicts; customer urgency elevated by a PoC deal.",
      createdAt: "2026-02-24",
      resolvedAt: "2026-03-13",
      durationDays: 17,
      assignee: "Akira Hiiro",
      reporter: "Jeremy Kuah",
      statusFlow:
        "Waiting for TSE → TEE - In Progress → Engineering Triage → Waiting for TSE → TEE - In Progress → Engineering Triage → TEE - In Progress → Waiting for TSE → Done → Archive",
      preventable: false,
      preventableReason:
        "The APM SSI + Istio interaction required containers + APM engineering knowledge. Multiple external TSE contributors could not resolve without Containers input.",
      solutionCategory: "Customer environment specific issue",
      escalationKind: "Engineering Triage",
      nonTeeInvolvement:
        "Roseanna McFarlane (APM/SSI TSE) provided SSI context and configuration suggestions. Varun Vasisth, Kiran Mangrulia (TSE / account) relayed urgency. Hossein Siadati commented via shared GPT tooling.",
      improvement:
        "A cross-team runbook for APM SSI + Istio patterns would reduce double-escalation (APM TSE → Containers TEE → Engineering Triage).",
    },
    {
      id: "CONS-8164",
      title:
        "Remote tagger cannot reach Cluster Agent on port 5005 (IPv6 formatting)",
      summary:
        "Remote tagger failed to reach the Cluster Agent on port 5005 in an IPv6 environment. Engineering identified a formatting bug: IPv6 addresses were not wrapped in square brackets when constructing the endpoint URL.",
      escalationReason:
        "Bug — IPv6 address formatting error in Cluster Agent endpoint construction.",
      createdAt: "2026-03-15",
      resolvedAt: "2026-03-25",
      durationDays: 10,
      assignee: "Mathieu Colin",
      reporter: "Mirza Nurkic",
      statusFlow:
        "TEE Triage → Waiting for TSE → TEE - In Progress → Engineering Triage → Done → Archive",
      preventable: false,
      preventableReason:
        "Required a code fix. Lénaïc Huard (engineering) identified the root cause and submitted a PR on Mar 25.",
      solutionCategory: "PR fix",
      escalationKind: "Engineering Triage",
      nonTeeInvolvement:
        "Lénaïc Huard (engineering) identified the root cause and submitted a PR fix to wrap IPv6 addresses in brackets when constructing the endpoint URL.",
      improvement: "Add an IPv6 regression test to prevent recurrence.",
    },
    {
      id: "CONS-8181",
      title:
        "Operator v1.24.0 introspection not configuring EKS control plane metrics",
      summary:
        "After upgrading to Operator v1.24.0, EKS control plane metrics stopped being collected. The introspection feature introduced in v1.24.0 changed how EKS control plane configuration is applied.",
      escalationReason:
        "Regression / configuration change in Operator v1.24.0 — introspection feature altered EKS control plane metrics collection behavior.",
      createdAt: "2026-03-20",
      resolvedAt: "2026-03-31",
      durationDays: 11,
      assignee: "Mathieu Colin",
      reporter: "Joshua Hayles",
      statusFlow:
        "TEE Triage → TEE - In Progress → Engineering Triage → Waiting for TSE → TEE - In Progress → Waiting for TSE → Done → Archive",
      preventable: false,
      preventableReason:
        "The introspection behavior change in v1.24.0 required engineering to clarify the expected configuration. Better migration documentation would have reduced the need for escalation.",
      solutionCategory: "Suggestion without PR or code fixes",
      escalationKind: "Engineering Triage",
      nonTeeInvolvement: "None.",
      improvement:
        "Add a migration guide / changelog callout for introspection-related breaking configuration changes in Operator releases.",
    },
    {
      id: "CONS-8186",
      title: "Configurable forceSyncPeriod in Operator to prevent API exhaustion",
      summary:
        "The Operator's fixed forceSyncPeriod for resource reconciliation caused excessive Kubernetes API calls, exhausting API rate limits for large clusters. Customer requested a configurable sync period.",
      escalationReason:
        "Feature request — no mechanism to tune forceSyncPeriod; customer hitting API exhaustion at scale.",
      createdAt: "2026-03-23",
      resolvedAt: "2026-04-02",
      durationDays: 10,
      assignee: "Patrick Liang",
      reporter: "Mike Hollis",
      statusFlow:
        "TEE Triage → TEE - In Progress → Engineering - In Progress → Waiting for TSE → Engineering - In Progress → Waiting for TSE → TEE - In Progress → Done → Archive",
      preventable: false,
      preventableReason:
        "Required engineering to implement the configurable forceSyncPeriod; this was a genuine feature gap.",
      solutionCategory: "PR fix",
      escalationKind: "Engineering - In Progress",
      nonTeeInvolvement:
        "TEE / engineering collaboration captured in the Engineering - In Progress status.",
      improvement:
        "Proactively document forceSyncPeriod tuning options and limits in the Operator docs to set customer expectations before reaching API exhaustion.",
    },
    {
      id: "CONS-8194",
      title:
        "Cluster Agent crashes when disabling Advanced Dispatching (Agent ≥ 7.74)",
      summary:
        "Disabling Advanced Dispatching (clusterChecksRunner.enabled: false) in Agent 7.74+ caused the Cluster Agent to crash. A regression introduced in 7.74.",
      escalationReason:
        "Bug / regression — Cluster Agent crash reproducible when disabling Advanced Dispatching on Agent ≥ 7.74.",
      createdAt: "2026-03-27",
      resolvedAt: "2026-04-05",
      durationDays: 9,
      assignee: "Patrick Liang",
      reporter: "Jun Shibata",
      statusFlow:
        "TEE Triage → TEE - In Progress → Engineering - In Progress → Waiting for TSE → Engineering - In Progress → Waiting for TSE → Done → Archive",
      preventable: false,
      preventableReason:
        "Genuine regression requiring a code fix. Engineering went directly to Engineering - In Progress, appropriate for a reproducible crash.",
      solutionCategory: "PR fix",
      escalationKind: "Engineering - In Progress",
      nonTeeInvolvement:
        "Engineering directly picked up the card from Engineering - In Progress.",
      improvement: "None; the escalation path was correct and efficient.",
    },
    {
      id: "CONS-8203",
      title: "vCluster: Kubelet issue resulting in missing logs (useApiServer)",
      summary:
        "In a vCluster environment, the agent was unable to collect pod logs due to a Kubelet API incompatibility. Setting useApiServer: true changed the log collection path and resolved the issue.",
      escalationReason:
        "Bug / compatibility — vCluster's virtual Kubelet does not expose the standard Kubelet log API.",
      createdAt: "2026-03-31",
      resolvedAt: "2026-04-12",
      durationDays: 12,
      assignee: "Mathieu Colin",
      reporter: "Daan Coenen",
      statusFlow:
        "TEE Triage → TEE - In Progress → Engineering Triage → Waiting for TSE → Done → Archive",
      preventable: false,
      preventableReason:
        "vCluster + Kubelet log collection is an emerging pattern requiring engineering guidance; the workaround was not documented for vCluster environments.",
      solutionCategory: "Suggestion without PR or code fixes",
      escalationKind: "Engineering Triage",
      nonTeeInvolvement: "Engineering provided guidance via Engineering Triage status.",
      improvement:
        "Add a vCluster integration guide to the Containers documentation covering log collection configuration.",
    },
  ],
  improvements: [
    {
      title: "KSM + CCR memory runbook",
      body: "CONS-8086 revealed a gap: TEE lacks a quick reference for diagnosing memory growth in CCRs co-running KSM Core checks. A 1-page internal KB note on KSM label cardinality + CCR sizing would prevent re-escalation for this pattern.",
    },
    {
      title: "GKE Autopilot runbook",
      body: "CONS-8154 was resolved by TEE alone. Adding a GKE Autopilot runbook (WorkloadAllowlist policy overrides, known Helm values) would prevent future Engineering Triage escalations for this class.",
    },
    {
      title: "Operator release notes / migration guides",
      body: "CONS-8181 and CONS-8186 both involved Operator behavior changes. Structured release-note callouts for breaking configuration changes (especially in introspection and reconciliation features) would reduce confusion on upgrades.",
    },
    {
      title: "APM SSI + Istio cross-team path",
      body: "CONS-8159 shows APM TSE escalating to Containers, then Containers escalating to Engineering. A shared Slack channel or direct escalation path between APM TSE and Containers Engineering would cut the chain.",
    },
    {
      title: "Windows agent compatibility matrix",
      body: "CONS-8117 involved an agent version × Docker version × Windows 2025 incompatibility. A living compatibility table would let TEE short-circuit diagnosis for Windows ECS crash cases.",
    },
    {
      title: "vCluster documentation",
      body: "CONS-8203 is the first vCluster case in this period. With vCluster adoption growing, a dedicated integration guide (log collection, Kubelet API compatibility, useApiServer guidance) should be created proactively.",
    },
  ],
};

export const REPORTS: ReportPeriod[] = [MARCH_2026];
