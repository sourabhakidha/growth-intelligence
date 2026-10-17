import { AppShell } from "@/components/layout/AppShell";
import { requireUser } from "@/lib/auth/guard";
import { isLiveDataEnabled } from "@/lib/data/run";
import { signOutAction } from "@/app/actions";

// Server-side authorization for every dashboard page (proxy.ts is only an optimistic redirect).
export default async function DashLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <AppShell userEmail={user.email} signOutAction={signOutAction} liveData={isLiveDataEnabled()}>
      {children}
    </AppShell>
  );
}
