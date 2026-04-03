import { describe, expect, it } from "vitest";

import { parseChartAnalysisStdout } from "@/lib/analysis-results";

describe("parseChartAnalysisStdout", () => {
  it("parses multi-series JSON chart payloads", () => {
    const parsed = parseChartAnalysisStdout(
      JSON.stringify({
        chart: {
          type: "line",
          title: "Weekly volume by queue",
          xLabel: "Datetime",
          yLabel: "Volume",
          series: [
            {
              name: "Queue A",
              x: ["2026-04-06 07:00", "2026-04-06 07:15"],
              y: [10, 12],
            },
            {
              name: "Queue B",
              x: ["2026-04-06 07:00", "2026-04-06 07:15"],
              y: [7, 9],
            },
          ],
        },
      }),
    );

    expect(parsed).toEqual({
      chartType: "line",
      title: "Weekly volume by queue",
      xLabel: "Datetime",
      yLabel: "Volume",
      series: [
        {
          name: "Queue A",
          x: ["2026-04-06 07:00", "2026-04-06 07:15"],
          y: [10, 12],
        },
        {
          name: "Queue B",
          x: ["2026-04-06 07:00", "2026-04-06 07:15"],
          y: [7, 9],
        },
      ],
    });
  });

  it("parses Python dict-style chart payloads from stdout", () => {
    const parsed = parseChartAnalysisStdout(`{'chart': {'type': 'line', 'title': 'Weekly volume by queue', 'xLabel': 'Datetime', 'yLabel': 'Volume', 'series': [{'name': 'Queue A', 'x': ['2026-04-06 07:00', '2026-04-06 07:15'], 'y': [10, 12]}, {'name': 'Queue B', 'x': ['2026-04-06 07:00', '2026-04-06 07:15'], 'y': [7, 9]}]}}`);

    expect(parsed).toEqual({
      chartType: "line",
      title: "Weekly volume by queue",
      xLabel: "Datetime",
      yLabel: "Volume",
      series: [
        {
          name: "Queue A",
          x: ["2026-04-06 07:00", "2026-04-06 07:15"],
          y: [10, 12],
        },
        {
          name: "Queue B",
          x: ["2026-04-06 07:00", "2026-04-06 07:15"],
          y: [7, 9],
        },
      ],
    });
  });
});
