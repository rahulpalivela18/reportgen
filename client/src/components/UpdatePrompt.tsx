import { ArrowDownToLine } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";

// Code updates (new features/fixes) ship as new app bundles — soft refresh
// can't fetch those, only the service worker can swap them. With
// registerType autoUpdate the new version downloads in the background;
// this bar appears when it's ready so PWA users get it in one tap
// instead of kill-and-reopen.
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Also check hourly while the PWA sits open for days on site.
      if (registration) {
        setInterval(() => registration.update(), 60 * 60 * 1000);
      }
    },
  });

  if (!needRefresh) return null;
  return (
    <div
      data-testid="update-prompt"
      className="bg-indigo-600 text-white text-xs font-semibold px-4 py-2 flex items-center justify-center gap-2 shrink-0"
    >
      A new version is ready.
      <button
        type="button"
        onClick={() => updateServiceWorker(true)}
        className="ml-1 underline underline-offset-2 font-bold flex items-center gap-1"
      >
        <ArrowDownToLine className="h-3.5 w-3.5" />
        Update now
      </button>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        className="ml-2 opacity-70 hover:opacity-100"
      >
        Later
      </button>
    </div>
  );
}
