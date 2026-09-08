import { useState, useRef, useCallback, useEffect } from "react";
import Layout from "@/components/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Trash2,
  Edit2,
  Camera,
  Move,
  ZoomIn,
  ZoomOut,
  Loader2,
  X,
  FileDown,
  Plus,
} from "lucide-react";
import { useRoute, useSearchParams, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { ensureJpeg, compressImageFile } from "@/lib/utils";
import CapturePDF from "@/components/CapturePDF";
import { pdf } from "@react-pdf/renderer";
import { useAuth } from "@/lib/auth";

// ─── Severity / status helpers ────────────────────────────────────────────────
const SEV_COLOR: Record<string, string> = {
  Major: "#dc2626",
  Cosmetic: "#f97316",
  Minor: "#22c55e",
};
const severityColor = (s?: string) => SEV_COLOR[s ?? ""] ?? "#3b82f6";

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  Open: { bg: "#fee2e2", text: "#991b1b" },
  "In Progress": { bg: "#ffedd5", text: "#9a3412" },
  Resolved: { bg: "#dcfce7", text: "#166534" },
};
const statusStyle = (s?: string) =>
  STATUS_STYLE[s ?? ""] ?? { bg: "#f1f5f9", text: "#475569" };

// ─── 360° coordinate conversion (x/y 0-1 ↔ pitch/yaw) ───────────────────────
function toPitchYaw(x: number, y: number) {
  return { yaw: (x - 0.5) * 360, pitch: (0.5 - y) * 180 };
}
function toXY(pitch: number, yaw: number) {
  return { x: yaw / 360 + 0.5, y: 0.5 - pitch / 180 };
}

declare global {
  interface Window {
    pannellum: any;
  }
}

// ─── Pannellum hotspot CSS injected once ─────────────────────────────────────
const HOTSPOT_STYLE = `
.cap-hs {
  width: 22px; height: 22px;
  border-radius: 50%;
  background: #3b82f6;
  border: 2.5px solid #fff;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,.35);
  transform: translate(-50%,-50%);
  transition: transform .15s;
}
.cap-hs:hover { transform: translate(-50%,-50%) scale(1.25); }
.cap-hs.sev-Major    { background: #dc2626; }
.cap-hs.sev-Cosmetic { background: #f97316; }
.cap-hs.sev-Minor    { background: #22c55e; }
`;

// ─── Types ────────────────────────────────────────────────────────────────────
interface PinDraft {
  x: number;
  y: number;
  label: string;
  notes: string;
  severity: string;
  status: string;
  photoDataUrl: string | null;
  photoFile: File | null;
  resolvedPhotoDataUrl: string | null;
}
const emptyDraft = (): PinDraft => ({
  x: 0, y: 0, label: "", notes: "",
  severity: "Minor", status: "Open",
  photoDataUrl: null, photoFile: null,
  resolvedPhotoDataUrl: null,
});

// ─── Component ────────────────────────────────────────────────────────────────
export default function CaptureCanvas() {
  const [, params] = useRoute("/project/:projectId/captures/:captureId");
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const projectId = params?.projectId;
  const captureId = params?.captureId;

  // Flat canvas
  const containerRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const DRAG_THRESHOLD = 5;

  // 360° mode
  const panoContainerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const adding360Ref = useRef(false);
  const [is360, setIs360] = useState(false);
  const [adding360, setAdding360] = useState(false);
  useEffect(() => { adding360Ref.current = adding360; }, [adding360]);

  // Stable callback ref so Pannellum hotspot handlers always have the latest setter
  const viewPinRef = useRef<(id: string) => void>(() => {});

  // Pin / dialog
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const [viewingPinId, setViewingPinId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PinDraft>(emptyDraft());
  const [deletePinId, setDeletePinId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const { user, workspace } = useAuth();

  // ── Queries ─────────────────────────────────────────────────────────────────
  const { data: capture, isLoading: loadingPlan } = useQuery({
    queryKey: ["capture", captureId],
    queryFn: () => api.getCapture(captureId!),
    enabled: !!captureId,
  });

  const { data: hotspots = [] } = useQuery({
    queryKey: ["hotspots", captureId],
    queryFn: () => api.getHotspots(captureId!),
    enabled: !!captureId,
  });

  // Keep viewPinRef current
  viewPinRef.current = (id: string) => setViewingPinId(id);

  // Deep link from the issues table: ?pin=<hotspotId> opens that hotspot once
  // the capture's hotspots load.
  useEffect(() => {
    const pinId = searchParams.get("pin");
    if (!pinId || hotspots.length === 0) return;
    const found = hotspots.some((p: any) => p.id === pinId);
    if (found) setViewingPinId(pinId);
  }, [searchParams, hotspots]);

  // ── 360° detection from stored field ──────────────────────────────────────
  useEffect(() => {
    if (capture) setIs360(!!capture.is360);
  }, [capture]);

  // ── Fit image to container on load / resize ─────────────────────────────
  useEffect(() => {
    if (!capture || is360) return;
    function updateFit() {
      const el = containerRef.current;
      if (!el || !capture.width || !capture.height) return;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const fit = Math.min(cw / capture.width, ch / capture.height, 1);
      setFitScale(fit);
      setScale(fit);
      setPanX(0);
      setPanY(0);
    }
    // Run after a tick so container has measured dimensions
    const raf = requestAnimationFrame(updateFit);
    window.addEventListener("resize", updateFit);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateFit);
    };
  }, [capture, is360]);

  // ── Inject hotspot CSS once ─────────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById("cap-hs-style")) return;
    const tag = document.createElement("style");
    tag.id = "cap-hs-style";
    tag.textContent = HOTSPOT_STYLE;
    document.head.appendChild(tag);
  }, []);

  // ── Ref so hotspot sync can be called from both effects without deps ─────
  const syncHotspotsRef = useRef<() => void>(() => {});

  // ── Sync Pannellum hotspots ──────────────────────────────────────────────
  useEffect(() => {
    if (!is360) return;
    syncHotspotsRef.current = () => {
      if (!viewerRef.current) return;
      try {
        const cfg = viewerRef.current.getConfig();
        if (!cfg) return;
        const existing: any[] = cfg.hotSpots ?? [];
        existing.forEach((hs: any) => { try { viewerRef.current.removeHotSpot(hs.id); } catch {} });
        hotspots.forEach((pin: any) => {
          const { pitch, yaw } = toPitchYaw(parseFloat(pin.x), parseFloat(pin.y));
          try {
            viewerRef.current.addHotSpot({
              id: pin.id,
              pitch,
              yaw,
              type: "custom",
              cssClass: `cap-hs sev-${pin.issueSeverity || ""}`,
              clickHandlerFunc: (_e: any, id: string) => viewPinRef.current(id),
              clickHandlerArgs: pin.id,
            });
          } catch {}
        });
      } catch {}
    };
    if (viewerRef.current) syncHotspotsRef.current();
  }, [hotspots, is360]);

  // ── Init Pannellum ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!is360 || !panoContainerRef.current || !capture?.imageUrl) return;
    let destroyed = false;

    const panoSrc = capture.imageUrl.startsWith("http") && !capture.imageUrl.startsWith(location.origin)
      ? `/api/image-proxy?url=${encodeURIComponent(capture.imageUrl)}`
      : capture.imageUrl;

    function initViewer() {
      if (destroyed || !panoContainerRef.current) return;
      if (viewerRef.current) { try { viewerRef.current.destroy(); } catch {} }

      viewerRef.current = window.pannellum.viewer(panoContainerRef.current, {
        type: "equirectangular",
        panorama: panoSrc,
        autoLoad: true,
        showZoomCtrl: false,
        showFullscreenCtrl: false,
        showControls: false,
        mouseZoom: true,
        compass: false,
      });

      // Sync hotspots after viewer is fully initialized
      setTimeout(() => syncHotspotsRef.current(), 300);

      panoContainerRef.current!.addEventListener("click", (e) => {
        if (!adding360Ref.current || !viewerRef.current) return;
        const coords = viewerRef.current.mouseEventToCoords(e as MouseEvent);
        if (!coords) return;
        const { x, y } = toXY(coords[0], coords[1]);
        setDraft({ ...emptyDraft(), x, y });
        setPinDialogOpen(true);
        setAdding360(false);
      });
    }

    if (window.pannellum) {
      initViewer();
    } else {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css";
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js";
      script.async = true;
      script.onload = initViewer;
      document.head.appendChild(link);
      document.head.appendChild(script);
    }

    return () => {
      destroyed = true;
      if (viewerRef.current) { try { viewerRef.current.destroy(); } catch {} viewerRef.current = null; }
    };
  }, [is360, capture?.imageUrl]);



  // ── Mutations ────────────────────────────────────────────────────────────────
  const createPinMutation = useMutation({
    mutationFn: async () => {
      if (!captureId) return;
      return api.createHotspot(captureId, {
        x: draft.x.toString(),
        y: draft.y.toString(),
        label: draft.label,
        notes: draft.notes || undefined,
        issueStatus: draft.status,
        issueSeverity: draft.severity,
        panoUrl: draft.photoDataUrl || undefined,
        resolvedPhoto: draft.resolvedPhotoDataUrl || undefined,
      });
    },

    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["hotspots", captureId] }); closePinDialog(); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updatePinMutation = useMutation({
    mutationFn: async () => {
      if (!editingPinId) return;
      const body: any = {
        label: draft.label,
        notes: draft.notes || undefined,
        issueStatus: draft.status,
        issueSeverity: draft.severity,
      };
      if (draft.photoDataUrl) body.panoUrl = draft.photoDataUrl;
      if (draft.resolvedPhotoDataUrl) body.resolvedPhoto = draft.resolvedPhotoDataUrl;
      return api.updateHotspot(editingPinId, body);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["hotspots", captureId] }); closePinDialog(); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deletePinMutation = useMutation({
    mutationFn: (id: string) => api.deleteHotspot(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["hotspots", captureId] }); setDeletePinId(null); setViewingPinId(null); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Dialog helpers ───────────────────────────────────────────────────────────
  function closePinDialog() {
    setPinDialogOpen(false);
    setEditingPinId(null);
    setDraft(emptyDraft());
  }

  function openEditForPin(pin: any) {
    setEditingPinId(pin.id);
    setDraft({
      x: parseFloat(pin.x),
      y: parseFloat(pin.y),
      label: pin.label,
      notes: pin.notes || "",
      severity: pin.issueSeverity || "Minor",
      status: pin.issueStatus || "Open",
      photoDataUrl: null,
      photoFile: null,
      resolvedPhotoDataUrl: null,
    });
    setViewingPinId(null);
    setPinDialogOpen(true);
  }

  // ── Flat canvas handlers ─────────────────────────────────────────────────────
  function handleCanvasPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragStart.current = { x: e.clientX, y: e.clientY };
  }
  function handleCanvasPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      setIsPanning(true);
      setPanX((px) => px + dx);
      setPanY((py) => py + dy);
      dragStart.current = { x: e.clientX, y: e.clientY };
    }
  }
  function handleCanvasPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const wasPanning = isPanning;
    setIsPanning(false);
    dragStart.current = null;
    if (wasPanning) return;
    if ((e.target as HTMLElement).closest("[data-pin]")) return;
    if (!containerRef.current || !capture) return;

    const rect = containerRef.current.getBoundingClientRect();
    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const ox = (rx - cx - panX) / scale;
    const oy = (ry - cy - panY) / scale;

    const imgX = ox + capture.width / 2;
    const imgY = oy + capture.height / 2;

    const x = imgX / capture.width;
    const y = imgY / capture.height;

    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setDraft({ ...emptyDraft(), x, y });
    setViewingPinId(null);
    setPinDialogOpen(true);
  }

  const handlePhotoSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    compressImageFile(file).then(
      ({ dataUrl }) => setDraft((p) => ({ ...p, photoDataUrl: dataUrl, photoFile: file })),
      () => {},
    );
  }, []);

  const resolvedPhotoInputRef = useRef<HTMLInputElement>(null);
  const handleResolvedPhotoSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    compressImageFile(file).then(
      ({ dataUrl }) => setDraft((p) => ({ ...p, resolvedPhotoDataUrl: dataUrl })),
      () => {},
    );
  }, []);

  function zoomIn() { setScale((s) => Math.min(s * 1.3, 5)); }
  function zoomOut() { setScale((s) => Math.max(s / 1.3, 0.3)); }
  function resetView() { setScale(fitScale); setPanX(0); setPanY(0); }

  // ── PDF export ───────────────────────────────────────────────────────────────
  async function handleExportPDF() {
    if (!capture || !projectId) return;
    setExporting(true);
    try {
      const project = await api.getProject(projectId);
      const pinsData = hotspots.map((pin: any) => ({
        id: pin.id,
        number: 0,
        label: pin.label,
        x: parseFloat(pin.x),
        y: parseFloat(pin.y),
        severity: pin.issueSeverity,
        status: pin.issueStatus,
        notes: pin.notes,
        hasPhoto: !!pin.panoUrl || !!pin.resolvedPhoto,
        panoUrl: pin.panoUrl,
        resolvedPhoto: pin.resolvedPhoto,
      }));

      const allPins = pinsData;
      const totalHotspots = allPins.length;
      const severityBreakdown = ["Major", "Cosmetic", "Minor", "Info"].map(
        (sev) => ({
          severity: sev,
          count: allPins.filter((p) => (p.severity || "Info") === sev).length,
        }),
      );
      const statusBreakdown = ["Open", "In Progress", "Resolved"].map(
        (st) => ({
          status: st,
          count: allPins.filter((p) => p.status === st).length,
        }),
      );

      const imageUrl = await ensureJpeg(capture.imageUrl);
      const logoUrl = workspace?.logoUrl ? await ensureJpeg(workspace.logoUrl) : undefined;
      const blob = await pdf(
        <CapturePDF
          captures={[{
            projectTitle: project.title,
            title: capture.title,
            imageUrl,
            imageWidth: capture.width,
            imageHeight: capture.height,
            totalCaptures: 1,
            companyName: workspace?.name,
            companyLogoUrl: logoUrl,
            companyAddress: workspace?.address,
            companyEmail: workspace?.email,
            companyPhone: workspace?.phone,
            clientName: project.clientName,
            projectAddress: project.address,
            pins: pinsData,
          }]}
          cover={{
            projectTitle: project.title,
            clientName: project.clientName,
            projectAddress: project.address,
            companyName: workspace?.name,
            companyLogoUrl: logoUrl,
            companyAddress: workspace?.address,
            companyPhone: workspace?.phone,
            totalCaptures: 1,
            totalHotspots,
            severityBreakdown,
            statusBreakdown,
          }}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${capture.title.replace(/\s+/g, "_")}_capture.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  const viewingPin = viewingPinId ? hotspots.find((p: any) => p.id === viewingPinId) : null;

  if (loadingPlan) {
    return (
      <Layout>
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-4rem)]">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-3 border-b bg-white shrink-0">
          <div>
            <Link
              href={`/project/${projectId}/captures${
                searchParams.toString() ? `?${searchParams.toString()}` : ""
              }`}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              ← All Captures
            </Link>
            <h1 className="text-lg font-bold text-slate-800">
              {capture?.title || "Capture"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">
              {hotspots.length} hotspot{hotspots.length !== 1 ? "s" : ""}
            </span>
            {is360 && user?.role !== "viewer" ? (
              <Button
                variant={adding360 ? "default" : "outline"}
                size="sm"
                onClick={() => setAdding360((v) => !v)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {adding360 ? "Click image to place…" : "Add Hotspot"}
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={resetView}>
                  <Move className="h-3.5 w-3.5 mr-1" /> Reset
                </Button>
                <Button variant="outline" size="sm" onClick={zoomOut}>
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs text-slate-500 w-10 text-center">
                  {Math.round(scale * 100)}%
                </span>
                <Button variant="outline" size="sm" onClick={zoomIn}>
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={exporting}>
              <FileDown className="h-3.5 w-3.5 mr-1" />
              {exporting ? "Exporting…" : "Export PDF"}
            </Button>
          </div>
        </div>

        {/* ── Canvas area ── */}
        <div className="flex-1 overflow-hidden bg-slate-200 relative">

          {/* 360° Pannellum viewer */}
          {is360 && (
            <>
              <div
                ref={panoContainerRef}
                className="absolute inset-0"
                style={{ cursor: adding360 ? "crosshair" : undefined }}
              />
              {adding360 && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-xs px-4 py-1.5 rounded-full shadow pointer-events-none z-10">
                  Click anywhere on the image to place a hotspot
                </div>
              )}

            </>
          )}

          {/* Flat image with hotspot markers */}
          {!is360 && (
            <div
              ref={containerRef}
              className="w-full h-full relative overflow-hidden touch-none"
              style={{ cursor: isPanning ? "grabbing" : "crosshair" }}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerLeave={() => { setIsPanning(false); dragStart.current = null; }}
            >
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{
                  transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
                  transformOrigin: "center center",
                }}
              >
                {capture && (
                  <div className="relative">
                    <img
                      src={capture.imageUrl}
                      alt={capture.title}
                      style={{ width: capture.width, height: capture.height, maxWidth: "none" }}
                      draggable={false}
                    />
                    {hotspots.map((pin: any) => {
                      const col = severityColor(pin.issueSeverity);
                      const isViewing = pin.id === viewingPinId;
                      return (
                        <button
                          key={pin.id}
                          data-pin={pin.id}
                          type="button"
                          className="absolute -translate-x-1/2 -translate-y-1/2 group"
                          style={{
                            left: `${parseFloat(pin.x) * 100}%`,
                            top: `${parseFloat(pin.y) * 100}%`,
                            transform: `translate(-50%,-50%) scale(${1 / scale})`,
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onPointerUp={(e) => e.stopPropagation()}
                          onClick={() => setViewingPinId(isViewing ? null : pin.id)}
                        >
                          <div
                            className="w-6 h-6 rounded-full border-2 border-white shadow-lg flex items-center justify-center transition-transform group-hover:scale-125"
                            style={{
                              backgroundColor: col,
                              transform: isViewing ? "scale(1.3)" : undefined,
                              boxShadow: isViewing ? `0 0 0 3px ${col}40` : undefined,
                            }}
                          >
                            <div className="w-2.5 h-2.5 rounded-full bg-white/90" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Detail panel ── */}
          {viewingPin && (
            <div className="absolute right-4 top-4 bottom-4 w-72 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden z-20 border border-slate-100">
              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b border-slate-100">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: severityColor(viewingPin.issueSeverity) }}
                  />
                  <span
                    className="text-[11px] font-bold uppercase tracking-widest truncate"
                    style={{ color: severityColor(viewingPin.issueSeverity) }}
                  >
                    {viewingPin.issueSeverity || "Hotspot"}
                  </span>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {user?.role !== "viewer" && (
                    <button
                      type="button"
                      className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                      title="Edit"
                      onClick={() => openEditForPin(viewingPin)}
                    >
                      <Edit2 className="h-3.5 w-3.5 text-slate-500" />
                    </button>
                  )}
                  {user?.role !== "viewer" && (
                    <button
                      type="button"
                      className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                      title="Delete"
                      onClick={() => setDeletePinId(viewingPin.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-400" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                    title="Close"
                    onClick={() => setViewingPinId(null)}
                  >
                    <X className="h-3.5 w-3.5 text-slate-400" />
                  </button>
                </div>
              </div>

              {/* Panel body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Title + status */}
                <div>
                  <h3 className="font-semibold text-slate-800 text-sm leading-snug">
                    {viewingPin.label}
                  </h3>
                  {viewingPin.issueStatus && (
                    <span
                      className="inline-block mt-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: statusStyle(viewingPin.issueStatus).bg,
                        color: statusStyle(viewingPin.issueStatus).text,
                      }}
                    >
                      {viewingPin.issueStatus}
                    </span>
                  )}
                </div>

                {/* Evidence photo */}
                {viewingPin.panoUrl && (
                  <div className="rounded-xl overflow-hidden border border-slate-100">
                    <img
                      src={viewingPin.panoUrl}
                      alt="Evidence"
                      className="w-full object-cover max-h-44"
                    />
                  </div>
                )}

                {viewingPin.notes && (
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Recommendations</p>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {viewingPin.notes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Add / Edit dialog ── */}
      <Dialog open={pinDialogOpen} onOpenChange={(open) => !open && closePinDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPinId ? "Edit Hotspot" : "New Hotspot"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="pin-label">Title</Label>
              <Input
                id="pin-label"
                value={draft.label}
                onChange={(e) => setDraft((p) => ({ ...p, label: e.target.value }))}
                placeholder="e.g. Crack in SW corner wall"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Severity</Label>
                <Select
                  value={draft.severity}
                  onValueChange={(v) => setDraft((p) => ({ ...p, severity: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Major">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-red-600 inline-block" />
                        Major
                      </span>
                    </SelectItem>
                    <SelectItem value="Cosmetic">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />
                        Cosmetic
                      </span>
                    </SelectItem>
                    <SelectItem value="Minor">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                        Minor
                      </span>
                    </SelectItem>
                    <SelectItem value="Info">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                        Info
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select
                  value={draft.status}
                  onValueChange={(v) => setDraft((p) => ({ ...p, status: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Open">Open</SelectItem>
                    <SelectItem value="In Progress">In Progress</SelectItem>
                    <SelectItem value="Resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="pin-notes">Recommendations (optional)</Label>
              <Textarea
                id="pin-notes"
                value={draft.notes}
                onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                placeholder="Describe the issue…"
              />
            </div>
            <div>
              <Label>Evidence Photo (optional)</Label>
              <div className="mt-1">
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handlePhotoSelect}
                />
                {draft.photoDataUrl ? (
                  <div className="relative rounded-lg overflow-hidden border mb-2">
                    <img src={draft.photoDataUrl} alt="Preview" className="w-full h-32 object-cover" />
                    <button
                      type="button"
                      className="absolute top-1 right-1 bg-black/50 rounded-full p-1"
                      onClick={() => setDraft((p) => ({ ...p, photoDataUrl: null, photoFile: null }))}
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                ) : editingPinId && hotspots.find((p: any) => p.id === editingPinId)?.panoUrl ? (
                  <div className="relative rounded-lg overflow-hidden border mb-2">
                    <img
                      src={hotspots.find((p: any) => p.id === editingPinId).panoUrl}
                      alt="Current"
                      className="w-full h-32 object-cover"
                    />
                    <span className="absolute bottom-1 left-1 text-[10px] bg-black/40 text-white px-1.5 py-0.5 rounded">
                      Current photo
                    </span>
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => photoInputRef.current?.click()}
                >
                  <Camera className="h-3.5 w-3.5 mr-1.5" />
                  {draft.photoDataUrl ? "Replace Photo" : "Add Photo"}
                </Button>
              </div>
            </div>
            {draft.status === "Resolved" && (
              <div>
                <Label>Resolution Photo (required when Resolved)</Label>
                <div className="mt-1">
                  <input
                    ref={resolvedPhotoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleResolvedPhotoSelect}
                  />
                  {draft.resolvedPhotoDataUrl ? (
                    <div className="relative rounded-lg overflow-hidden border mb-2">
                      <img src={draft.resolvedPhotoDataUrl} alt="Resolved preview" className="w-full h-32 object-cover" />
                      <button
                        type="button"
                        className="absolute top-1 right-1 bg-black/50 rounded-full p-1"
                        onClick={() => setDraft((p) => ({ ...p, resolvedPhotoDataUrl: null }))}
                      >
                        <X className="h-3 w-3 text-white" />
                      </button>
                    </div>
                  ) : editingPinId && hotspots.find((p: any) => p.id === editingPinId)?.resolvedPhoto ? (
                    <div className="relative rounded-lg overflow-hidden border mb-2">
                      <img
                        src={hotspots.find((p: any) => p.id === editingPinId).resolvedPhoto}
                        alt="Current resolved"
                        className="w-full h-32 object-cover"
                      />
                      <span className="absolute bottom-1 left-1 text-[10px] bg-black/40 text-white px-1.5 py-0.5 rounded">
                        Current resolution photo
                      </span>
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => resolvedPhotoInputRef.current?.click()}
                  >
                    <Camera className="h-3.5 w-3.5 mr-1.5" />
                    {draft.resolvedPhotoDataUrl ? "Replace Photo" : "Add Resolution Photo"}
                  </Button>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            {editingPinId && (
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700 mr-auto"
                onClick={() => { closePinDialog(); setDeletePinId(editingPinId); }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
              </Button>
            )}
            <Button variant="outline" onClick={closePinDialog}>Cancel</Button>
            <Button
              onClick={() => editingPinId ? updatePinMutation.mutate() : createPinMutation.mutate()}
              disabled={
                !draft.label ||
                (draft.status === "Resolved" && !draft.resolvedPhotoDataUrl && !(editingPinId && hotspots.find((p: any) => p.id === editingPinId)?.resolvedPhoto)) ||
                (editingPinId ? updatePinMutation.isPending : createPinMutation.isPending)
              }
            >
              {editingPinId ? "Save" : "Add Hotspot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
      <AlertDialog open={!!deletePinId} onOpenChange={() => setDeletePinId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Hotspot?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this hotspot from the capture.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() => deletePinId && deletePinMutation.mutate(deletePinId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
