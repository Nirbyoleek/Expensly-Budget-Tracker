import { describe, expect, it } from "vitest";
import { mergeWrappedRows } from "../pdf";
import { parseTextStatement } from "../parsers";
import { prepareRows } from "../core";

const row = (y: number, ...cells: [number, string][]) => ({ y, items: cells.map(([x, s]) => ({ x, s })) });

describe("mergeWrappedRows", () => {
  it("glues centred narration lines back onto their transaction", () => {
    const rows = [
      row(700, [40, "Date"], [120, "Narration"], [400, "Withdrawal"], [470, "Deposit"], [540, "Balance"]),
      row(682, [120, "UPI/DR/527412345678/ZOMATO"]),
      row(670, [40, "01/10/2026"], [330, "-"], [400, "361.00"], [540, "10,000.00"]),
      row(658, [120, "/YESB/zomato@yes/Pay"]),
      row(640, [120, "UPI/CR/527412349999/LARA"]),
      row(628, [40, "02/10/2026"], [330, "-"], [470, "87.00"], [540, "10,087.00"]),
      row(616, [120, "SHARMA/SBIN/lara@okaxis"]),
    ];
    const lines = mergeWrappedRows(rows);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("ZOMATO");
    expect(lines[1]).toContain("361.00");
    expect(lines[2]).toContain("LARA");

    const parsed = prepareRows(parseTextStatement(lines.join("\n"), "2026-10-23"), [], { hash: false });
    expect(parsed[0].merchant_name).toBe("Zomato");
    expect(parsed[0].amount_paise).toBe(-36100);
    expect(parsed[1].amount_paise).toBe(8700);
    expect(parsed[1].category_id).toBe("people"); // a friend paying back offsets what you sent
  });

  it("leaves single-line statements alone", () => {
    const rows = [row(600, [40, "01/10/2026"], [120, "SWIGGY BANGALORE"], [400, "250.00"]), row(588, [40, "02/10/2026"], [120, "UBER"], [400, "120.00"])];
    expect(mergeWrappedRows(rows)).toEqual(["01/10/2026  SWIGGY BANGALORE  250.00", "02/10/2026  UBER  120.00"]);
  });
});

describe("date-only and UPI rows", () => {
  it("names date-only rows by direction and doesn't read DR as doctor", () => {
    const out = prepareRows(
      [
        { date: "2026-10-01", amount_paise: 2500, merchant_raw: "01/10/2026 - -", source: "import" },
        { date: "2026-10-01", amount_paise: -11900, merchant_raw: "01/10/2026 -", source: "import" },
        { date: "2026-10-05", amount_paise: -24000, merchant_raw: "05/10/2026 UPI/DR/ /GAURAV -", source: "import" },
      ],
      [],
      { hash: false },
    );
    expect(out[0].merchant_name).toBe("Money received");
    expect(out[1].merchant_name).toBe("Money sent");
    expect(out[2].category_id).toBe("people");
  });
});
