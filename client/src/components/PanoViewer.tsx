import { useEffect, useRef } from "react";
import { X, MapPin, Info } from "lucide-react";
// Bundled (not CDN) so the 360 viewer works offline — vite precaches it
// with the app shell.
import "pannellum/build/pannellum.js";
import "pannellum/build/pannellum.css";

interface PanoViewerProps {
  pin: {
    id: string;
    label: string;
    panoUrl: string;
    notes?: string;
    issueTitle?: string;
    issueStatus?: string;
    issueSeverity?: string;
  };
  open: boolean;
  onClose: () => void;
}

declare global {
  interface Window {
    pannellum: any;
  }
}

export default function PanoViewer({ pin, open, onClose }: PanoViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);

  useEffect(() => {
    if (!open || !containerRef.current || !pin.panoUrl) return;

    viewerRef.current = window.pannellum.viewer(containerRef.current, {
      type: "equirectangular",
      panorama: pin.panoUrl,
      autoLoad: true,
      compass: true,
      hotSpotDebug: false,
      showZoomCtrl: true,
      showFullscreenCtrl: true,
      showControls: true,
    });

    return () => {
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy();
        } catch {}
        viewerRef.current = null;
      }
    };
  }, [open, pin.panoUrl, pin.id]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-black/80 text-white shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="h-4 w-4 shrink-0 text-indigo-400" />
          <span className="font-medium truncate">{pin.label}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
          type="button"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 relative">
        <div ref={containerRef} className="absolute inset-0" />
      </div>

      {(pin.issueTitle || pin.notes) && (
        <div className="shrink-0 px-4 py-3 bg-black/80 text-white text-sm space-y-1">
          {pin.issueTitle && (
            <div className="flex items-center gap-2">
              <Info className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
              <span className="font-medium">{pin.issueTitle}</span>
              {pin.issueStatus && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-white/10">
                  {pin.issueStatus}
                </span>
              )}
              {pin.issueSeverity && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-white/10">
                  {pin.issueSeverity}
                </span>
              )}
            </div>
          )}
          {pin.notes && (
            <p className="text-slate-400 text-xs pl-5">{pin.notes}</p>
          )}
        </div>
      )}
    </div>
  );
}
