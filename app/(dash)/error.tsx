"use client";

import { ErrorState } from "@/components/state/States";

export default function DashError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-3">
      <ErrorState
        title="This page could not be loaded"
        detail={error.digest ? `Reference: ${error.digest}. Details are in the server logs.` : "Details are in the server logs."}
      />
      <div className="text-center">
        <button type="button" onClick={reset} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-surface-2">
          Try again
        </button>
      </div>
    </div>
  );
}
