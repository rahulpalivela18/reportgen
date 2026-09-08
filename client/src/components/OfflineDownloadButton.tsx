import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CloudDownload,
  Loader2,
  RefreshCw,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { subscribeOnlineStatus } from "@/lib/offline";
import {
  downloadProjectForOffline,
  getOfflinePackage,
  clearOfflinePackage,
  formatBytes,
  type OfflinePackage,
  type PrefetchProgress,
} from "@/lib/prefetch";
import { useToast } from "@/hooks/use-toast";

// Per-project "Make Available Offline" — downloads the project's data +
// image bytes (see lib/prefetch.ts) so field work survives dead zones.
// One package per project: every instance shares state via IndexedDB, so
// the full button (reports page) and the compact pill (captures page) are
// two fittings of the same download — tapping either does the same thing.
export function OfflineDownloadButton({
  projectId,
  compact = false,
}: {
  projectId: string;
  compact?: boolean;
}) {
  const { toast } = useToast();
  const [pkg, setPkg] = useState<OfflinePackage | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PrefetchProgress | null>(null);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    getOfflinePackage(projectId).then(setPkg);
  }, [projectId]);

  useEffect(() => subscribeOnlineStatus(setOnline), []);

  const handleDownload = async () => {
    setBusy(true);
    setProgress({ phase: "data", done: 0, total: 1 });
    try {
      const result = await downloadProjectForOffline(projectId, setProgress);
      setPkg(result);
      const failed = result.errors > 0 ? `, ${result.errors} failed` : "";
      const capped =
        (result.skippedBudget ?? 0) > 0 ? " — oldest skipped (budget)" : "";
      toast({
        title: "Available offline",
        description:
          result.imageTotal > 0
            ? `${result.imageCount}/${result.imageTotal} photos (${formatBytes(result.imageBytes)}) saved${capped}${failed}.`
            : "Project data saved. No photos found in this project yet.",
      });
    } catch {
      toast({
        title: "Download failed",
        description: "Couldn't finish the offline package. Try again on WiFi.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleRemove = async () => {
    await clearOfflinePackage(projectId);
    setPkg(null);
  };

  if (busy && progress) {
    const pct =
      progress.phase === "done"
        ? 100
        : progress.total > 0
          ? Math.round((progress.done / progress.total) * 100)
          : 0;
    const label =
      progress.phase === "data" ? "Saving…" : `Saving ${pct}%`;
    if (compact) {
      return (
        <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {label}
        </span>
      );
    }
    return (
      <Button size="lg" variant="outline" disabled className="w-full sm:w-auto">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {progress.phase === "data"
          ? "Saving project data…"
          : `Saving photos… ${pct}%`}
      </Button>
    );
  }

  if (pkg) {
    const ageDays = Math.floor((Date.now() - pkg.downloadedAt) / 86400000);
    if (compact) {
      return (
        <button
          type="button"
          onClick={handleDownload}
          disabled={!online}
          title={
            online
              ? `Offline ready • ${formatBytes(pkg.imageBytes)} — tap to update`
              : "Offline ready — reconnect to update"
          }
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-700 hover:border-emerald-300 disabled:opacity-70"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Offline • {formatBytes(pkg.imageBytes)}
          <RefreshCw className="h-3 w-3 opacity-60" />
        </button>
      );
    }
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          Available offline • {formatBytes(pkg.imageBytes)}
          {pkg.imageTotal > 0
            ? ` • ${pkg.imageCount}/${pkg.imageTotal} photos`
            : ""}
          {ageDays > 0 ? ` • ${ageDays}d ago` : " • today"}
          {pkg.errors > 0 ? ` • ${pkg.errors} skipped` : ""}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownload}
            disabled={!online}
            title={online ? "Re-download" : "Reconnect to update"}
            className="flex-1"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Update
          </Button>
          <Button size="sm" variant="ghost" onClick={handleRemove}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  if (compact && !pkg) {
    return (
      <button
        type="button"
        onClick={handleDownload}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:border-slate-300"
        data-testid="button-offline-download"
      >
        <CloudDownload className="h-3.5 w-3.5" />
        Make offline
      </button>
    );
  }

  return (
    <Button
      size="lg"
      variant="outline"
      onClick={handleDownload}
      className="w-full sm:w-auto"
      data-testid="button-offline-download"
    >
      <CloudDownload className="mr-2 h-4 w-4" /> Make Available Offline
    </Button>
  );
}
