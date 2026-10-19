import { AppShell } from "@/components/layout/AppShell";
import { requireUser } from "@/lib/auth/guard";
import { isLiveDataEnabled } from "@/lib/data/run";
import { signOutAction } from "@/app/actions";

// Server-side authorization for every dashboard page. There is no proxy/middleware: this is the gate.
export default async function DashLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <AppShell userLabel={`Signed in as ${user.label}`} signOutAction={signOutAction} liveData={isLiveDataEnabled()}>
      {children}
    </AppShell>
  );
}
