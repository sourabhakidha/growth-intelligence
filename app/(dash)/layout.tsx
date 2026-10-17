import { AppShell } from "@/components/layout/AppShell";
import { requireUser } from "@/lib/auth/guard";
import { isOpenAccess } from "@/lib/auth/mode";
import { isLiveDataEnabled } from "@/lib/data/run";
import { signOutAction } from "@/app/actions";

// Server-side authorization for every dashboard page (proxy.ts is only an optimistic redirect).
// In open access mode requireUser() always succeeds.
export default async function DashLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <AppShell userEmail={user.email} signOutAction={isOpenAccess() ? null : signOutAction} liveData={isLiveDataEnabled()}>
      {children}
    </AppShell>
  );
}
