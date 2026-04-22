import { describe, expect, it } from "vitest";

import { buildChatSystemPrompt } from "@/lib/chat-system-prompt";

describe("buildChatSystemPrompt", () => {
  it("stays general-purpose and avoids narrow domain-specific examples", () => {
    const prompt = buildChatSystemPrompt("owner");
    const normalized = prompt.toLowerCase();

    expect(normalized).not.toContain("property management");
    expect(normalized).not.toContain("contractors_new.csv");
    expect(normalized).not.toContain("ledger_year");
    expect(normalized).not.toContain("queue a");
    expect(normalized).not.toContain("top product by each region");
  });

  it("instructs complete grouped-result answers instead of sample-only summaries", () => {
    const prompt = buildChatSystemPrompt("owner");

    expect(prompt).toContain("include all requested groups in the final answer");
    expect(prompt).toContain("instead of showing only examples");
  });

  it("applies role-aware search scope rules", () => {
    const ownerPrompt = buildChatSystemPrompt("owner");
    const memberPrompt = buildChatSystemPrompt("member");

    expect(ownerPrompt).toContain("You may search all files inside the current organization's company_data");
    expect(memberPrompt).toContain(
      "You may search only public files inside the current organization's company_data/public",
    );
  });

  it("includes sandbox guardrails to prevent write-permission errors and ungrounded numeric answers", () => {
    const prompt = buildChatSystemPrompt("owner");

    expect(prompt).toContain("inputs/ directory is read-only");
    expect(prompt).toContain("save at most one file");
    expect(prompt).toContain("do not present computed values as final facts");
    expect(prompt).toContain("only provide numeric conclusions from successful tool output");
  });

  it("prefers sandbox preflight hints over manual CSV sniffing in Python", () => {
    const prompt = buildChatSystemPrompt("owner");

    expect(prompt).toContain("rely on sandbox preflight diagnostics");
    expect(prompt).toContain("Do not add manual delimiter/line-ending sniffing code in Python");
    expect(prompt).not.toContain("inspect a small sample");
  });

  it("tells follow-up chart requests to verify prior data still covers the new scope", () => {
    const prompt = buildChatSystemPrompt("owner");

    expect(prompt).toContain("Before reusing analysisResultId or previously selected files for a follow-up");
    expect(prompt).toContain("If the user adds a new year, date range, metric, group, comparison, or file");
    expect(prompt).toContain("search_company_knowledge again");
  });

  it("treats @file mentions as explicit company file selections", () => {
    const prompt = buildChatSystemPrompt("owner");

    expect(prompt).toContain("@admin/quarterly_report_2026.csv");
    expect(prompt).toContain("treat those as explicit file selections");
    expect(prompt).toContain("Prefer those exact paths in inputFiles");
  });

  it("routes clearly causal questions away from chat conclusions", () => {
    const prompt = buildChatSystemPrompt("owner");

    expect(prompt).toContain("do not present a causal conclusion in chat");
    expect(prompt).toContain("dedicated causal workspace");
  });

  it("starts why-questions with observational decomposition before causal escalation", () => {
    const prompt = buildChatSystemPrompt("owner");

    expect(prompt).toContain("start with descriptive decomposition, competing explanations, and observational contributors first");
    expect(prompt).toContain("Escalate to the causal workspace only when the user explicitly wants a causal or counterfactual conclusion");
  });

  it("encourages analytical back-and-forth when the question or data fit is still unclear", () => {
    const prompt = buildChatSystemPrompt("owner");

    expect(prompt).toContain("prefer a short back-and-forth");
    expect(prompt).toContain("refine the question, the target metric, the time window, the unit of analysis");
    expect(prompt).toContain("ask a focused follow-up instead of guessing");
    expect(prompt).toContain("what data would be needed, what is available, what is missing");
  });

  it("requires explicit claim labels for chat-side descriptive and diagnostic answers", () => {
    const prompt = buildChatSystemPrompt("owner");

    expect(prompt).toContain("state the claim label explicitly near the top");
    expect(prompt).toContain("Use DESCRIPTIVE for observational summaries");
    expect(prompt).toContain("UNTESTED HYPOTHESES for observational diagnostic decomposition");
  });

  it("keeps predictive planning in chat before sending users to the predictive workspace", () => {
    const prompt = buildChatSystemPrompt("owner");

    expect(prompt).toContain("keep the interaction in chat first");
    expect(prompt).toContain("help the user define the target, prediction horizon");
    expect(prompt).toContain("before recommending that they run the dedicated predictive workspace");
    expect(prompt).toContain("use update_predictive_plan");
    expect(prompt).toContain("use open_predictive_workspace");
    expect(prompt).toContain("Prefer opening the predictive workspace in a new tab");
    expect(prompt).toContain("give a short business-readable handoff summary");
    expect(prompt).toContain("Objective, Target, Horizon, Candidate Drivers, Constraints, Success Metric, and Ready for Predictive Workspace");
    expect(prompt).toContain("Do not force business users to speak in modeling jargon");
    expect(prompt).toContain("end with the clearest next planning question");
    expect(prompt).toContain("Refresh update_predictive_plan whenever the target, horizon, candidate drivers, constraints, success metric, or readiness status changes");
    expect(prompt).toContain("If a predictive workspace update returns to chat, explain what the run means in business terms, recommend the next step based on signal quality");
    expect(prompt).toContain("instrumental / heuristic rather than causal");
    expect(prompt).toContain("asking what would happen if they changed a policy, treatment, price, or intervention");
  });
});
