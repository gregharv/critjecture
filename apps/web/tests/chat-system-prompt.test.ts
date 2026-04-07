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
});
