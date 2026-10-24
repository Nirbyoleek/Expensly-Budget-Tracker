import { describe, expect, it } from "vitest";
import { addMonths, dayOf, daysInMonth, firstWeekdayMon, longDate, monthLong, monthShort, monthStart, shortDate, todayISO } from "../dates";

describe("dates", () => {
  it("uses India time for today, so the month doesn't flip early on a UTC server", () => {
    // 20:00 UTC on 31 Oct is already 1 Nov in India
    expect(todayISO(new Date("2026-10-31T20:00:00Z"))).toBe("2026-11-01");
    expect(todayISO(new Date("2026-10-31T18:00:00Z"))).toBe("2026-10-31");
  });

  it("handles month arithmetic across years", () => {
    expect(monthStart("2026-10-24")).toBe("2026-10-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2026-11-01", 3)).toBe("2027-02-01");
    expect(addMonths("2026-10-01", 0)).toBe("2026-10-01");
  });

  it("knows month lengths, including leap years", () => {
    expect(daysInMonth("2026-02-10")).toBe(28);
    expect(daysInMonth("2028-02-01")).toBe(29);
    expect(daysInMonth("2026-10-01")).toBe(31);
    expect(daysInMonth("2026-11-01")).toBe(30);
  });

  it("formats dates", () => {
    expect(dayOf("2026-10-07")).toBe(7);
    expect(monthShort("2026-10-07")).toBe("Oct");
    expect(monthLong("2026-10-07")).toBe("October 2026");
    expect(shortDate("2026-10-07")).toBe("Oct 7");
    expect(longDate("2026-10-24")).toBe("Saturday, 24 Oct");
  });

  it("gives the Monday-first weekday of the 1st", () => {
    expect(firstWeekdayMon("2026-10-01")).toBe(3); // Thursday
    expect(firstWeekdayMon("2026-06-01")).toBe(0); // Monday
    expect(firstWeekdayMon("2026-11-01")).toBe(6); // Sunday
  });
});
