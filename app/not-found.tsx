import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-sm font-medium text-ink">Page not found</p>
      <Link href="/" className="text-xs text-accent underline">
        Back to Overview
      </Link>
    </main>
  );
}
