import { describe, expect, it } from "vitest";

import { parseWorkflowDeliveryJson, WorkflowContractValidationError } from "@/lib/workflow-types";

describe("workflow delivery email alert events", () => {
  it("defaults email events to run_completed when omitted", () => {
    const delivery = parseWorkflowDeliveryJson({
      channels: [
        {
          enabled: true,
          kind: "email",
          recipients: ["ops@example.com"],
        },
      ],
      schema_version: 1,
    });

    const channel = delivery.channels.find((entry) => entry.kind === "email");

    expect(channel).toMatchObject({
      enabled: true,
      events: ["run_completed"],
      kind: "email",
      recipients: ["ops@example.com"],
    });
  });

  it("accepts explicit workflow email alert event selections", () => {
    const delivery = parseWorkflowDeliveryJson({
      channels: [
        {
          enabled: true,
          events: ["run_failed", "waiting_for_input", "run_completed"],
          kind: "email",
          recipients: ["ops@example.com", "owner@example.com"],
        },
      ],
      schema_version: 1,
    });

    const channel = delivery.channels.find((entry) => entry.kind === "email");

    expect(channel).toMatchObject({
      enabled: true,
      events: ["run_failed", "waiting_for_input", "run_completed"],
      kind: "email",
      recipients: ["ops@example.com", "owner@example.com"],
    });
  });

  it("rejects unknown workflow email alert events", () => {
    expect(() =>
      parseWorkflowDeliveryJson({
        channels: [
          {
            enabled: true,
            events: ["run_failed", "delivery_failed"],
            kind: "email",
            recipients: ["ops@example.com"],
          },
        ],
        schema_version: 1,
      }),
    ).toThrow(WorkflowContractValidationError);
  });
});
