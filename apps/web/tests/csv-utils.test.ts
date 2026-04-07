import { describe, expect, it } from "vitest";

import { countCsvDelimiters, splitCsvRecord } from "@/lib/csv-utils";

describe("csv utils", () => {
  it("splits CSV rows with quoted commas", () => {
    const cells = splitCsvRecord(
      '1,3,10/13/2010,"Eldon Base for stackable storage shelf, platinum",Large Box',
    );

    expect(cells).toEqual([
      "1",
      "3",
      "10/13/2010",
      "Eldon Base for stackable storage shelf, platinum",
      "Large Box",
    ]);
  });

  it("unescapes doubled quotes in quoted cells", () => {
    const cells = splitCsvRecord('"1.7 Cubic Foot Compact ""Cube"" Office Refrigerators",Jumbo Drum');

    expect(cells).toEqual([
      '1.7 Cubic Foot Compact "Cube" Office Refrigerators',
      "Jumbo Drum",
    ]);
  });

  it("counts delimiters outside quoted cells only", () => {
    expect(countCsvDelimiters('"contractor, legal";payout', ",")).toBe(0);
    expect(countCsvDelimiters('"contractor, legal";payout', ";")).toBe(1);
  });
});
