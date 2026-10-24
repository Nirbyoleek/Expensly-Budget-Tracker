import { AppProvider } from "@/components/app";
import AddSheet from "@/components/AddSheet";
import TabBar from "@/components/TabBar";
import Sidebar from "@/components/Sidebar";
import CommandPalette from "@/components/CommandPalette";
import OfflineSync from "@/components/OfflineSync";
import PageTracker from "@/components/PageTracker";
import { getCategories, getRecentTransactions, getRules } from "@/lib/data";
import { buildMemory } from "@/lib/ingest/classify";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [cats, rules, tx] = await Promise.all([getCategories(), getRules(), getRecentTransactions()]);
  // What you've confirmed before, so new imports land where you'd put them.
  const memory = [...buildMemory(tx)];
  return (
    <AppProvider cats={cats} rules={rules} memory={memory}>
      <div className="shell">
        <Sidebar />
        <main className="app">{children}</main>
      </div>
      <TabBar />
      <AddSheet />
      <CommandPalette />
      <OfflineSync />
      <PageTracker />
    </AppProvider>
  );
}
