import { redirect } from "next/navigation";
import { addMonths, monthStart, todayISO } from "@/lib/dates";

/** /review on its own opens last month, the most recent finished one. */
export default function ReviewIndex() {
  redirect(`/review/${addMonths(monthStart(todayISO()), -1).slice(0, 7)}`);
}
