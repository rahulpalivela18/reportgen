import { useState, useRef, useMemo, useEffect } from "react";
import Layout from "@/components/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MapIcon,
  Plus,
  Trash2,
  Loader2,
  ImageUp,
  FileDown,
  AlertTriangle,
  AlertCircle,
  CircleDot,
  CheckCircle2,
  Hash,
  Layers,
  Search,
  Clock,
  ArrowLeft,
  Camera,
  CalendarPlus,
  Tags,
  CheckSquare,
  Pencil,
} from "lucide-react";
import { useRoute, useLocation, useSearchParams } from "wouter";
import { ProjectTabs } from "@/components/ProjectTabs";
import { OfflineDownloadButton } from "@/components/OfflineDownloadButton";
import { useToast } from "@/hooks/use-toast";
import { ensureJpeg, compressImageFile, cn, isAdminRole } from "@/lib/utils";
import { isQueuedResponse, OFFLINE_QUEUED_MARKER } from "@/lib/offline";
import { seedCachedDetail, appendToCachedList } from "@/lib/prefetch";
import CapturePDF from "@/components/CapturePDF";
import { pdf } from "@react-pdf/renderer";
import { useAuth } from "@/lib/auth";
import { TagSelect, type TagOption } from "@/components/TagSelect";
import NotFound from "./not-found";

const TAG_CATEGORIES = [
  { key: "block", label: "Block" },
  { key: "floor", label: "Floor" },
  { key: "flat", label: "Flat" },
  { key: "amenity", label: "Amenity" },
] as const;
type TagCategory = (typeof TAG_CATEGORIES)[number]["key"];

import {
  SEVERITY_COLORS,
  STATUS_COLORS,
  StackedBar,
  IssueBreakdownCard,
  ResolutionStatusCard,
  DefectsTable,
} from "@/components/analytics/SharedAnalytics";

const PAGE_SIZE = 8;
const CAPTURES_PAGE_SIZE = 24;

export default function CaptureManager() {
  const { user, workspace, refreshTrial } = useAuth();
  const [, params] = useRoute("/project/:id/captures");
  const [location, setLocation] = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const setUrlParam = (key: string, value: string | null) => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value === null || value === "" || value === "all") p.delete(key);
        else p.set(key, value);
        return p;
      },
      { replace: true }
    );
  };
  // Tag filters are one ?tag=cat:id each; rewrite the whole set together.
  const setUrlTags = (filters: Partial<Record<TagCategory, string>>) => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete("tag");
        for (const cat of TAG_CATEGORIES.map((t) => t.key)) {
          const id = filters[cat];
          if (id) p.append("tag", `${cat}:${id}`);
        }
        return p;
      },
      { replace: true }
    );
  };
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [is360Upload, setIs360Upload] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [exportingAll, setExportingAll] = useState(false);

  /* ── Tags: which value is selected per category while tagging, and the
     "sticky" last-used values that pre-fill the next capture automatically
     so nobody re-fills Block/Floor/Flat for every photo in the same spot ── */
  const [selectedTagIds, setSelectedTagIds] = useState<
    Partial<Record<TagCategory, string>>
  >({});

  /* ── Burst mode: tag once, then the camera keeps firing with no dialog
     interruption between shots ── */
  const [burstMode, setBurstMode] = useState(false);
  const [burstCount, setBurstCount] = useState(0);

  /* ── Visits (named inspection rounds) ── */
  const [isNewVisitOpen, setIsNewVisitOpen] = useState(false);
  const [newVisitTitle, setNewVisitTitle] = useState("");
  const [openCameraAfterVisit, setOpenCameraAfterVisit] = useState(false);

  /* ── "Untagged" bulk cleanup ── */
  const [isBulkTagOpen, setIsBulkTagOpen] = useState(false);
  const [bulkTagIds, setBulkTagIds] = useState<
    Partial<Record<TagCategory, string>>
  >({});

  // Per-capture tag editing: which capture is being tagged later + its tags.
  const [tagEditCapture, setTagEditCapture] = useState<any | null>(null);
  const [tagEditIds, setTagEditIds] = useState<
    Partial<Record<TagCategory, string>>
  >({});

  // Per-capture rename.
  const [renameCapture, setRenameCapture] = useState<any | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

  /* ── Filters — visible the moment captures load, not gated behind
     analytics/hotspot loading. Search is the primary tool here. Values live
     in the URL (?area=&severity=&status=&q=&visit=&untagged=&tag=cat:val) so
     leaving and returning keeps the exact view. ── */
  const [areaFilter, setAreaFilter] = useState(
    () => searchParams.get("area") ?? "all"
  );
  const [severityFilter, setSeverityFilter] = useState(
    () => searchParams.get("severity") ?? "all"
  );
  const [statusFilter, setStatusFilter] = useState(
    () => searchParams.get("status") ?? "all"
  );
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [page, setPage] = useState(1);
  const [tagFilters, setTagFilters] = useState<
    Partial<Record<TagCategory, string>>
  >(() => {
    const out: Partial<Record<TagCategory, string>> = {};
    for (const tag of searchParams.getAll("tag")) {
      const [cat, val] = tag.split(":");
      if (cat && val) (out as any)[cat] = val;
    }
    return out;
  });
  const [visitFilter, setVisitFilter] = useState<string>(
    () => searchParams.get("visit") ?? "all"
  );
  // True once the visitor's visit filter has been decided — either by an
  // explicit ?visit= in the URL or by our auto-default. Prevents us from
  // clobbering a manual "All visits" pick.
  const visitDefaultedRef = useRef(searchParams.get("visit") !== null);
  const [untaggedOnly, setUntaggedOnly] = useState(
    () => searchParams.get("untagged") === "1"
  );

  const [resultsView, setResultsView] = useState<"captures" | "issues">(
    () => (searchParams.get("view") === "issues" ? "issues" : "captures")
  );

  const [visibleCount, setVisibleCount] = useState(CAPTURES_PAGE_SIZE);

  const hasActiveFilters =
    areaFilter !== "all" ||
    severityFilter !== "all" ||
    statusFilter !== "all" ||
    !!search ||
    visitFilter !== "all" ||
    untaggedOnly ||
    Object.values(tagFilters).some(Boolean);

  const projectId = params?.id;

  const { data: project, isError: projectError } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
    retry: false,
  });

  const { data: captures = [], isLoading } = useQuery({
    queryKey: ["captures", projectId],
    queryFn: () => api.getCaptures(projectId!),
    enabled: !!projectId,
  });

  const { data: tagValues = [] } = useQuery({
    queryKey: ["tagValues", projectId],
    queryFn: () => api.getTagValues(projectId!),
    enabled: !!projectId,
  });
  const tagsByCategory: Record<TagCategory, TagOption[]> = {
    block: [],
    floor: [],
    flat: [],
    amenity: [],
  };
  for (const t of tagValues as any[]) {
    tagsByCategory[t.category as TagCategory]?.push({ id: t.id, value: t.value });
  }

  const { data: visits = [] } = useQuery({
    queryKey: ["visits", projectId],
    queryFn: () => api.getVisits(projectId!),
    enabled: !!projectId,
  });

  // "No visit yet" is a normal state (brand-new project), not an error — the
  // camera button uses this to decide whether to prompt for a visit name.
  const { data: currentVisit } = useQuery({
    queryKey: ["currentVisit", projectId],
    queryFn: async () => {
      try {
        return await api.getCurrentVisit(projectId!);
      } catch {
        return null;
      }
    },
    enabled: !!projectId,
  });

  // Default the visit filter to the latest visit (currentVisit, else newest
  // by createdAt — getVisitsByProject is newest-first) so opening a project
  // shows the most recent round without the visitor re-picking it. Only runs
  // when nothing was chosen yet, and only once per project page.
  useEffect(() => {
    if (visitDefaultedRef.current) return;
    if (visitFilter !== "all") return;
    if (visits.length === 0) return;
    const latestId = currentVisit?.id ?? visits[0]?.id;
    if (!latestId) return;
    visitDefaultedRef.current = true;
    setVisitFilter(latestId);
  }, [visits, currentVisit, visitFilter]);

  const { data: captureHotspots = [] } = useQuery({
    queryKey: ["allHotspots", projectId],
    queryFn: async () => {
      return Promise.all(
        captures.map(async (cap: any) => {
          const hotspots = await api.getHotspots(cap.id);
          return { capture: cap, hotspots };
        })
      );
    },
    enabled: !!projectId && captures.length > 0,
  });

  const hotspotsLoaded =
    captureHotspots.length === captures.length && captures.length > 0;

  /* ── Filtered Area-Wise Defect Summary ── */
  const hotspotMatches = (h: any) => {
    if (severityFilter !== "all" && h.issueSeverity !== severityFilter)
      return false;
    if (statusFilter !== "all" && h.issueStatus !== statusFilter) return false;
    return true;
  };

  // Single capture-level predicate driving the WHOLE dashboard — grid, stats,
  // area summary. One filter source, so visit/block/untagged picks re-count
  // every KPI automatically.
  const captureMatches = (c: any) => {
    if (areaFilter !== "all" && c.title !== areaFilter) return false;
    if (search && !c.title.toLowerCase().includes(search.toLowerCase()))
      return false;
    if (visitFilter !== "all" && c.visitId !== visitFilter) return false;
    if (untaggedOnly && (c.tags?.length ?? 0) > 0) return false;
    for (const cat of TAG_CATEGORIES.map((t) => t.key)) {
      const wanted = tagFilters[cat];
      if (!wanted) continue;
      if (!c.tags?.some((t: any) => t.tagValueId === wanted)) return false;
    }
    return true;
  };

  const filteredHotspots = captureHotspots
    .filter((c: any) => captureMatches(c.capture))
    .flatMap((c) => c.hotspots)
    .filter(hotspotMatches);

  /* ── Overall (filter-aware) project totals — power KPI + analytics cards ── */
  const overall = {
    major: filteredHotspots.filter((h: any) => h.issueSeverity === "Major")
      .length,
    minor: filteredHotspots.filter((h: any) => h.issueSeverity === "Minor")
      .length,
    cosmetic: filteredHotspots.filter(
      (h: any) => h.issueSeverity === "Cosmetic"
    ).length,
    resolved: filteredHotspots.filter((h: any) => h.issueStatus === "Resolved")
      .length,
    open: filteredHotspots.filter((h: any) => h.issueStatus === "Open").length,
    inProgress: filteredHotspots.filter(
      (h: any) => h.issueStatus === "In Progress"
    ).length,
    total: filteredHotspots.length,
  };

  const pct = (n: number) =>
    overall.total > 0 ? ((n / overall.total) * 100).toFixed(1) : "0.0";

  const issueBreakdown = [
    { label: "Major", count: overall.major, color: SEVERITY_COLORS.Major },
    { label: "Minor", count: overall.minor, color: SEVERITY_COLORS.Minor },
    {
      label: "Cosmetic",
      count: overall.cosmetic,
      color: SEVERITY_COLORS.Cosmetic,
    },
  ];
  const resolutionBreakdown = [
    { label: "Open", count: overall.open, color: STATUS_COLORS.Open },
    {
      label: "Resolved",
      count: overall.resolved,
      color: STATUS_COLORS.Resolved,
    },
    {
      label: "In Progress",
      count: overall.inProgress,
      color: STATUS_COLORS["In Progress"],
    },
  ];
  const resolutionTotal = overall.open + overall.resolved + overall.inProgress;

  const uniqueAreas = Array.from(
    new Set(
      captureHotspots
        .filter((c: any) => captureMatches(c.capture))
        .map((c: any) => c.capture.title)
    )
  );

  /* ── Defect rows — one row per issue across matching captures, honoring
     every filter (capture-level + severity/status). This replaced the old
     area-wise count table. ── */
  const issueRows = useMemo(() => {
    const rows: { capture: any; hotspot: any; visitTitle?: string }[] = [];
    for (const { capture, hotspots } of captureHotspots) {
      if (areaFilter !== "all" && capture.title !== areaFilter) continue;
      if (search && !capture.title.toLowerCase().includes(search.toLowerCase()))
        continue;
      if (visitFilter !== "all" && capture.visitId !== visitFilter) continue;
      if (untaggedOnly && (capture.tags?.length ?? 0) > 0) continue;
      let tagMatch = true;
      for (const cat of TAG_CATEGORIES.map((t) => t.key)) {
        const wanted = tagFilters[cat];
        if (!wanted) continue;
        if (!capture.tags?.some((t: any) => t.tagValueId === wanted)) {
          tagMatch = false;
          break;
        }
      }
      if (!tagMatch) continue;
      const visitTitle = visits.find((v: any) => v.id === capture.visitId)?.title ?? "";
      for (const h of hotspots) {
        if (severityFilter !== "all" && h.issueSeverity !== severityFilter)
          continue;
        if (statusFilter !== "all" && h.issueStatus !== statusFilter) continue;
        rows.push({ capture, hotspot: h, visitTitle });
      }
    }
    return rows;
  }, [
    captureHotspots,
    areaFilter,
    search,
    visitFilter,
    untaggedOnly,
    tagFilters,
    severityFilter,
    statusFilter,
    visits,
  ]);

  const totalIssuePages = Math.max(1, Math.ceil(issueRows.length / PAGE_SIZE));
  const issueSafePage = Math.min(page, totalIssuePages);
  const pagedIssues = issueRows.slice(
    (issueSafePage - 1) * PAGE_SIZE,
    issueSafePage * PAGE_SIZE
  );

  /* Per-capture issue counts (respects severity/status filters via issueRows)
     — powers the severity dots on each capture card. */
  const issueCountByCapture = useMemo(() => {
    const m = new Map<
      string,
      { major: number; minor: number; cosmetic: number; total: number }
    >();
    for (const { capture, hotspot } of issueRows) {
      const cur = m.get(capture.id) ?? {
        major: 0,
        minor: 0,
        cosmetic: 0,
        total: 0,
      };
      if (hotspot.issueSeverity === "Major") cur.major++;
      else if (hotspot.issueSeverity === "Minor") cur.minor++;
      else cur.cosmetic++;
      cur.total++;
      m.set(capture.id, cur);
    }
    return m;
  }, [issueRows]);

  /* ── Filtered recent captures ── */
  const filteredCaptures = useMemo(() => {
    return [...captures]
      .filter((c: any) => areaFilter === "all" || c.title === areaFilter)
      .filter(
        (c: any) =>
          !search || c.title.toLowerCase().includes(search.toLowerCase())
      )
      .filter((c: any) => visitFilter === "all" || c.visitId === visitFilter)
      .filter((c: any) =>
        untaggedOnly ? (c.tags?.length ?? 0) === 0 : true
      )
      .filter((c: any) => {
        for (const cat of TAG_CATEGORIES.map((t) => t.key)) {
          const wanted = tagFilters[cat];
          if (!wanted) continue;
          if (!c.tags?.some((t: any) => t.tagValueId === wanted)) return false;
        }
        return true;
      })
      .filter((c: any) => {
        if (severityFilter === "all" && statusFilter === "all") return true;
        const entry = captureHotspots.find(
          (x: any) => x.capture.id === c.id
        );
        return (entry?.hotspots ?? []).some(
          (h: any) =>
            (severityFilter === "all" || h.issueSeverity === severityFilter) &&
            (statusFilter === "all" || h.issueStatus === statusFilter)
        );
      })
      .sort(
        (a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }, [
    captures,
    areaFilter,
    search,
    visitFilter,
    untaggedOnly,
    tagFilters,
    severityFilter,
    statusFilter,
    captureHotspots,
  ]);

  const untaggedCount = captures.filter(
    (c: any) => (c.tags?.length ?? 0) === 0
  ).length;

  const visibleCaptures = filteredCaptures.slice(0, visibleCount);
  const hasMoreCaptures = visibleCount < filteredCaptures.length;

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(CAPTURES_PAGE_SIZE);
  }, [areaFilter, severityFilter, statusFilter, search, visitFilter, untaggedOnly, tagFilters]);

  function readFileAsCapture(file: File) {
    return compressImageFile(file);
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (selectedFiles.length === 0 || !projectId || !currentVisit) return;
      const tagValueIds = Object.values(selectedTagIds).filter(Boolean) as string[];
      // Multiple files selected at once (native multi-select import) share
      // the same title/tags — a bulk import of one batch, tagged once.
      const results = await Promise.all(
        selectedFiles.map(async (file, i) => {
          console.log("[upload] reading file", i, file.size);
          const { dataUrl, width, height } = await readFileAsCapture(file);
          console.log("[upload] compressed", i, `${width}x${height}`);
          const title =
            selectedFiles.length > 1
              ? `${newTitle || "Capture"} ${i + 1}`
              : newTitle || "Capture";
          console.log("[upload] sending capture", i, title);
          return api.createCapture(projectId, {
            title,
            imageUrl: dataUrl,
            width,
            height,
            is360: is360Upload,
            visitId: currentVisit.id,
            tagValueIds,
          });
        })
      );
      return results;
    },
    onSuccess: (results: any) => {
      // Offline: pencil newborn captures into the grid instantly (they live
      // in the outbox until sync). Tags resolve from known values.
      if (
        Array.isArray(results) &&
        results.length > 0 &&
        results.every(isQueuedResponse)
      ) {
        const lookup = new Map(
          (tagValues as any[]).map((t: any) => [t.id, t]),
        );
        const items = results.map((r: any) => {
          const { [OFFLINE_QUEUED_MARKER]: _, ...rest } = r;
          const tags = ((rest.tagValueIds ?? []) as string[])
            .map((tagValueId: string) => {
              const t = lookup.get(tagValueId);
              return t
                ? {
                    captureId: rest.id,
                    tagValueId,
                    category: t.category,
                    value: t.value,
                  }
                : null;
            })
            .filter(Boolean);
          return {
            ...rest,
            tags,
            createdAt: new Date().toISOString(),
          };
        });
        queryClient.setQueryData(["captures", projectId], (old: any[]) => [
          ...items,
          ...(old ?? []),
        ]);
        items.forEach((item: any) => {
          seedCachedDetail(`/api/captures/${item.id}`, item);
          appendToCachedList(`/api/projects/${projectId}/captures`, item);
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ["captures", projectId] });
      }
      refreshTrial();
      setSelectedFiles([]);
      setPreviewUrl(null);
      setIs360Upload(false);
      if (burstMode) {
        // Stay open, keep the same tags, just bump the counter and let the
        // user fire the next shot — no re-tagging between photos.
        setBurstCount((n) => n + selectedFiles.length);
      } else {
        setIsUploadOpen(false);
        setNewTitle("");
      }
    },
    onError: (err: any) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createVisitMutation = useMutation({
    mutationFn: (title: string) => api.createVisit(projectId!, title),
    onSuccess: (visit: any) => {
      if (isQueuedResponse(visit)) {
        // Offline: the newborn visit IS the current one — badge it active
        // everywhere so the camera targets it immediately.
        const { [OFFLINE_QUEUED_MARKER]: _, ...rest } = visit;
        const active = { ...rest, active: true };
        queryClient.setQueryData(["visits", projectId], (old: any[]) => [
          active,
          ...((old ?? []).map((v: any) => ({ ...v, active: false }))),
        ]);
        queryClient.setQueryData(["currentVisit", projectId], active);
        seedCachedDetail(
          `/api/projects/${projectId}/visits/current`,
          active,
        );
        appendToCachedList(`/api/projects/${projectId}/visits`, active);
      } else {
        queryClient.invalidateQueries({ queryKey: ["visits", projectId] });
        queryClient.invalidateQueries({
          queryKey: ["currentVisit", projectId],
        });
      }
      setIsNewVisitOpen(false);
      setNewVisitTitle("");
      if (openCameraAfterVisit) {
        setOpenCameraAfterVisit(false);
        setIsUploadOpen(true);
      }
    },
    onError: (err: any) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const activateVisitMutation = useMutation({
    mutationFn: (visitId: string) => api.activateVisit(projectId!, visitId),
    onSuccess: (activated: any, visitId: string) => {
      if (isQueuedResponse(activated)) {
        // Offline echo carries no row — flip the badge using the id we sent.
        const flip = (list: any[]) =>
          (list ?? []).map((v: any) => ({
            ...v,
            active: v.id === visitId,
          }));
        queryClient.setQueryData(["visits", projectId], (old: any[]) =>
          flip(old),
        );
        const current = flip(
          queryClient.getQueryData<any[]>(["visits", projectId]) ?? [],
        ).find((v: any) => v.id === visitId);
        if (current) {
          queryClient.setQueryData(["currentVisit", projectId], current);
          seedCachedDetail(
            `/api/projects/${projectId}/visits/current`,
            current,
          );
        }
        toast({ title: "Visit switched — will sync" });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["visits", projectId] });
      queryClient.invalidateQueries({ queryKey: ["currentVisit", projectId] });
      toast({
        title: `Now capturing to "${activated.title}"`,
        description: "New photos sent here.",
      });
    },
    onError: (err: any) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const tagEditMutation = useMutation({
    mutationFn: ({ id, tagValueIds }: { id: string; tagValueIds: string[] }) =>
      api.setCaptureTags(id, tagValueIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["captures", projectId] });
      setTagEditCapture(null);
      setTagEditIds({});
      toast({ title: "Tags updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setTagEditCapture(null);
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.updateCapture(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["captures", projectId] });
      setRenameCapture(null);
      toast({ title: "Capture renamed" });
    },
    onError: (err: any) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const bulkTagMutation = useMutation({
    mutationFn: () => {
      const ids = Object.values(bulkTagIds).filter(Boolean) as string[];
      const untaggedIds = captures
        .filter((c: any) => (c.tags?.length ?? 0) === 0)
        .map((c: any) => c.id);
      return api.bulkTagCaptures(projectId!, untaggedIds, ids);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["captures", projectId] });
      setIsBulkTagOpen(false);
      setBulkTagIds({});
      toast({ title: "Tags applied" });
    },
    onError: (err: any) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteCapture(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["captures", projectId] });
      refreshTrial();
      setDeleteId(null);
    },
    onError: (err: any) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  async function handleExportAllPDF() {
    if (!projectId) return;
    setExportingAll(true);
    try {
      const projectData = await api.getProject(projectId);
      const logoUrl = workspace?.logoUrl
        ? await ensureJpeg(workspace.logoUrl)
        : undefined;
      const exportSet = filteredCaptures;
      const captureData = await Promise.all(
        exportSet.map(async (fp: any) => {
          const pins = await api.getHotspots(fp.id);
          const imageUrl = await ensureJpeg(fp.imageUrl);
          return {
            projectTitle: projectData.title,
            title: fp.title,
            imageUrl,
            imageWidth: fp.width,
            imageHeight: fp.height,
            totalCaptures: exportSet.length,
            companyName: workspace?.name,
            companyLogoUrl: logoUrl,
            companyAddress: workspace?.address,
            companyEmail: workspace?.email,
            companyPhone: workspace?.phone,
            clientName: projectData.clientName,
            projectAddress: projectData.address,
            pins: pins.map((p: any) => ({
              id: p.id,
              number: 0,
              label: p.label,
              x: parseFloat(p.x),
              y: parseFloat(p.y),
              severity: p.issueSeverity,
              status: p.issueStatus,
              notes: p.notes,
              hasPhoto: !!p.panoUrl || !!p.resolvedPhoto,
              panoUrl: p.panoUrl,
              resolvedPhoto: p.resolvedPhoto,
            })),
          };
        })
      );
      const allPdfPins = captureData.flatMap((c) => c.pins);
      const totalHotspots = allPdfPins.length;
      const severityBreakdown = ["Major", "Cosmetic", "Minor", "Info"].map(
        (sev) => ({
          severity: sev,
          count: allPdfPins.filter((p) => (p.severity || "Info") === sev)
            .length,
        })
      );
      const statusBreakdown = ["Open", "In Progress", "Resolved"].map((st) => ({
        status: st,
        count: allPdfPins.filter((p) => p.status === st).length,
      }));
      const blob = await pdf(
        <CapturePDF
          captures={captureData}
          cover={{
            projectTitle: projectData.title,
            clientName: projectData.clientName,
            projectAddress: projectData.address,
            companyName: workspace?.name,
            companyLogoUrl: logoUrl,
            companyAddress: workspace?.address,
            companyPhone: workspace?.phone,
            totalCaptures: captureData.length,
            totalHotspots,
            severityBreakdown,
            statusBreakdown,
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectData.title.replace(/\s+/g, "_")}_captures.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({
        title: "Export failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setExportingAll(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setSelectedFiles(files);
    // Preview only makes sense for a single file — a multi-select import
    // just shows a count (see the dialog JSX below).
    setPreviewUrl(files.length === 1 ? URL.createObjectURL(files[0]) : null);
  }

  // The camera button always targets the current visit. If this project has
  // no visit yet (brand new), prompt for one first — the same small dialog
  // as "+ New Visit" — then open the capture form automatically once it's
  // created. No auto-detection, no guessing: the user is always in control.
  function handleCameraClick() {
    if (!currentVisit) {
      setOpenCameraAfterVisit(true);
      setIsNewVisitOpen(true);
      return;
    }
    setBurstCount(0);
    setIsUploadOpen(true);
  }

  const kpiCards = [
    {
      label: "Total Issues",
      value: overall.total,
      icon: Hash,
      color: "text-slate-600",
      bg: "bg-slate-100",
      valueColor: "text-slate-900",
      subtitle: `Across ${uniqueAreas.length} ${
        uniqueAreas.length === 1 ? "area" : "areas"
      }`,
    },
    {
      label: "Major Issues",
      value: overall.major,
      icon: AlertTriangle,
      color: "text-red-600",
      bg: "bg-red-50",
      valueColor: "text-red-600",
      subtitle: `${pct(overall.major)}% of total`,
    },
    {
      label: "Minor Issues",
      value: overall.minor,
      icon: AlertCircle,
      color: "text-amber-500",
      bg: "bg-amber-50",
      valueColor: "text-amber-600",
      subtitle: `${pct(overall.minor)}% of total`,
    },
    {
      label: "Cosmetic Issues",
      value: overall.cosmetic,
      icon: CircleDot,
      color: "text-blue-500",
      bg: "bg-blue-50",
      valueColor: "text-blue-600",
      subtitle: `${pct(overall.cosmetic)}% of total`,
    },
    {
      label: "Resolved Issues",
      value: overall.resolved,
      icon: CheckCircle2,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      valueColor: "text-emerald-600",
      subtitle: `${pct(overall.resolved)}% of total`,
    },
  ];

  const selectCls =
    "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 outline-none cursor-pointer hover:border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

  if (projectError) return <NotFound />;

  return (
    <Layout>
      <div className="p-6 lg:p-8 space-y-6 max-w-[1440px] mx-auto">
        {/* ── Back link + tabs ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => setLocation("/dashboard")}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
            All Projects
          </button>
          <ProjectTabs
            projectId={projectId!}
            active="captures"
            admin={isAdminRole(user?.role)}
          />
        </div>

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl lg:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
              Captures
            </h1>
            <div className="flex items-center gap-2 flex-wrap text-sm text-slate-500 mt-2">
              <span className="font-semibold text-slate-700">
                {project?.title ?? "Loading project..."}
              </span>
              <span className="w-[3px] h-[3px] rounded-full bg-slate-400" />
              <span>
                {overall.total} {overall.total === 1 ? "Issue" : "Issues"}
              </span>
              <span className="w-[3px] h-[3px] rounded-full bg-slate-400" />
              <span>
                {uniqueAreas.length}{" "}
                {uniqueAreas.length === 1 ? "Area" : "Areas"}
              </span>
              {currentVisit && visits.length > 0 && (
                <>
                  <span className="w-[3px] h-[3px] rounded-full bg-slate-400" />
                  <span className="inline-flex items-center gap-1 font-medium text-indigo-600">
                    <CalendarPlus className="h-3 w-3" />
                    <select
                      className="bg-transparent border border-indigo-200 rounded-md px-1 py-0.5 text-xs font-medium text-indigo-700 focus:outline-none cursor-pointer hover:border-indigo-400"
                      value={currentVisit.id}
                      disabled={activateVisitMutation.isPending}
                      onChange={(e) =>
                        activateVisitMutation.mutate(e.target.value)
                      }
                      data-testid="select-active-visit"
                      title="Switch which visit new photos are captured to"
                    >
                      {visits.map((v: any) => (
                        <option key={v.id} value={v.id}>
                          {v.active ? "● " : ""}
                          {v.title}
                        </option>
                      ))}
                    </select>
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            {projectId && <OfflineDownloadButton projectId={projectId} compact />}
            {captures.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportAllPDF}
                disabled={exportingAll}
                className="h-9"
              >
                <FileDown className="h-4 w-4 mr-1.5" />
                {exportingAll
                  ? "Exporting..."
                  : filteredCaptures.length !== captures.length
                    ? `Export PDF (${filteredCaptures.length})`
                    : "Export PDF"}
              </Button>
            )}
            {user?.role !== "viewer" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    setNewVisitTitle(
                      new Date().toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    );
                    setOpenCameraAfterVisit(false);
                    setIsNewVisitOpen(true);
                  }}
                  title="Start a new named inspection round, e.g. 'Stage Inspection'"
                >
                  <CalendarPlus className="h-4 w-4 mr-1.5" />
                  New Visit
                </Button>
                <Button
                  size="sm"
                  onClick={handleCameraClick}
                  className="h-9 bg-indigo-600 hover:bg-indigo-700"
                >
                  <Camera className="h-4 w-4 mr-1.5" />
                  New Capture
                </Button>
              </>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          </div>
        ) : captures.length === 0 ? (
          <div className="text-center py-20">
            <MapIcon className="h-12 w-12 mx-auto mb-3 opacity-50 text-slate-400" />
            <p className="text-lg font-medium text-slate-700">Nothing added</p>
            <p className="text-sm mt-1 text-slate-400">
              Log an issue to start your inspection
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-7">
              {user?.role !== "viewer" && (
                <Button
                  size="lg"
                  className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-600/20"
                  onClick={handleCameraClick}
                >
                  <Camera className="h-4 w-4 mr-2" /> Add Capture
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* ── Search & Filter — the most powerful tool in the app, visible
                the instant captures load, never hidden behind analytics ── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex flex-wrap items-center gap-2.5 px-5 py-4">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setUrlParam("q", e.target.value || null);
                      setPage(1);
                    }}
                    placeholder="Search captures..."
                    className="w-full h-9 rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <select
                  className={selectCls}
                  value={areaFilter}
                  onChange={(e) => {
                    setAreaFilter(e.target.value);
                    setUrlParam("area", e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All Areas</option>
                  {uniqueAreas.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                {TAG_CATEGORIES.map(({ key, label }) => (
                  <TagSelect
                    key={key}
                    label={label}
                    values={tagsByCategory[key]}
                    selectedId={tagFilters[key] ?? null}
                    onChange={(id) => {
                      const next = { ...tagFilters, [key]: id ?? undefined };
                      setTagFilters(next);
                      setUrlTags(next);
                    }}
                    allOption={{ label: `All ${label}s` }}
                  />
                ))}
                {visits.length > 0 && (
                  <select
                    className={selectCls}
                    value={visitFilter}
                    onChange={(e) => {
                      setVisitFilter(e.target.value);
                      setUrlParam("visit", e.target.value);
                    }}
                  >
                    <option value="all">All Visits</option>
                    {visits.map((v: any) => (
                      <option key={v.id} value={v.id}>
                        {v.title}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setUntaggedOnly((v) => {
                      setUrlParam("untagged", !v ? "1" : null);
                      return !v;
                    })
                  }
                  className={cn(
                    "h-9 rounded-lg border px-3 text-sm font-medium transition-colors",
                    untaggedOnly
                      ? "border-amber-300 bg-amber-50 text-amber-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  )}
                >
                  <Tags className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
                  Untagged {untaggedCount > 0 && `(${untaggedCount})`}
                </button>
                <select
                  className={selectCls}
                  value={severityFilter}
                  onChange={(e) => {
                    setSeverityFilter(e.target.value);
                    setUrlParam("severity", e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All Issue Types</option>
                  <option value="Major">Major</option>
                  <option value="Minor">Minor</option>
                  <option value="Cosmetic">Cosmetic</option>
                </select>
                <select
                  className={selectCls}
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setUrlParam("status", e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All Status</option>
                  <option value="Open">Open</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Resolved">Resolved</option>
                </select>
              </div>

              {untaggedCount > 0 && (
                <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-amber-100 bg-amber-50/60">
                  <p className="text-[13px] text-amber-800">
                    {untaggedCount} capture{untaggedCount === 1 ? "" : "s"}{" "}
                    {untaggedCount === 1 ? "has" : "have"} no tags yet.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 border-amber-300 text-amber-700 hover:bg-amber-100"
                    onClick={() => setIsBulkTagOpen(true)}
                  >
                    <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
                    Apply tags to all
                  </Button>
                </div>
              )}
            </div>

            {/* ── KPI Cards ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 lg:gap-4">
              {kpiCards.map((kpi) => (
                <div
                  key={kpi.label}
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ${kpi.bg} mb-3.5`}
                  >
                    <kpi.icon className={`h-[18px] w-[18px] ${kpi.color}`} />
                  </div>
                  <p
                    className={`text-3xl lg:text-[2rem] font-extrabold tabular-nums leading-none ${kpi.valueColor}`}
                  >
                    {kpi.value}
                  </p>
                  <p className="text-[13px] font-semibold text-slate-600 mt-2.5">
                    {kpi.label}
                  </p>
                  <p className="text-[11.5px] text-slate-400 mt-1">
                    {kpi.subtitle}
                  </p>
                </div>
              ))}
            </div>

            {/* ── Analytics ── */}
            {hotspotsLoaded && overall.total > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <IssueBreakdownCard
                  items={issueBreakdown}
                  totalCount={overall.total}
                />
                <ResolutionStatusCard
                  segments={resolutionBreakdown}
                  resolvedCount={overall.resolved}
                  totalCount={resolutionTotal}
                />
              </div>
            )}

            {/* ── Results — one view at a time, so no duplication: either the
                captures grid or the per-issue table, both from the same
                filtered set. ── */}
            <div>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-1.5 bg-white rounded-xl border border-slate-200 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setResultsView("captures");
                      setUrlParam("view", "captures");
                    }}
                    className={cn(
                      "px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors",
                      resultsView === "captures"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    Captures
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setResultsView("issues");
                      setUrlParam("view", "issues");
                    }}
                    className={cn(
                      "px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors",
                      resultsView === "issues"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    Issues
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  {resultsView === "captures"
                    ? `${filteredCaptures.length} of ${captures.length} captures`
                    : `${issueRows.length} ${issueRows.length === 1 ? "issue" : "issues"}`}
                </p>
              </div>

              {resultsView === "issues" ? (
                hotspotsLoaded && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <DefectsTable
                      rows={pagedIssues}
                      totalCount={issueRows.length}
                      page={issueSafePage}
                      totalPages={totalIssuePages}
                      onPageChange={setPage}
                      onOpenRow={({ capture, hotspot }) => {
                        const p = new URLSearchParams(searchParams.toString());
                        p.set("pin", hotspot.id);
                        setLocation(
                          `/project/${projectId}/captures/${capture.id}?${p.toString()}`
                        );
                      }}
                    />
                  </div>
                )
              ) : (
                <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                {visibleCaptures.map((fp: any) => {
                  const capTotal =
                    captureHotspots.find((c: any) => c.capture.id === fp.id)
                      ?.hotspots.length ?? 0;
                  const ic = issueCountByCapture.get(fp.id);
                  return (
                    <div
                      key={fp.id}
                      onClick={() => {
                        const qs = searchParams.toString();
                        setLocation(
                          `/project/${projectId}/captures/${fp.id}${
                            qs ? `?${qs}` : ""
                          }`
                        );
                      }}
                      className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md group cursor-pointer"
                    >
                      <div className="aspect-[16/11] bg-slate-100 relative overflow-hidden">
                        <img
                          src={fp.imageUrl}
                          alt={fp.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        {user?.role !== "viewer" && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const byCat: Partial<
                                  Record<TagCategory, string>
                                > = {};
                                for (const t of fp.tags ?? []) {
                                  byCat[t.category as TagCategory] = t.tagValueId;
                                }
                                setTagEditIds(byCat);
                                setTagEditCapture(fp);
                              }}
                              title="Edit tags"
                              className="absolute top-2 left-2 h-7 w-7 grid place-items-center rounded-lg bg-white/90 text-slate-600 shadow opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:bg-white"
                            >
                              <Tags className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenameTitle(fp.title);
                                setRenameCapture(fp);
                              }}
                              title="Rename capture"
                              className="absolute top-2 left-11 h-7 w-7 grid place-items-center rounded-lg bg-white/90 text-slate-600 shadow opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:bg-white"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteId(fp.id);
                              }}
                              className="absolute top-2 right-2 h-7 w-7 grid place-items-center rounded-lg bg-white/90 text-red-600 shadow opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:bg-white"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                      <div className="px-3.5 pt-3 pb-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold text-slate-900 text-[13.5px] leading-snug">
                            {fp.title}
                          </h3>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          {capTotal} {capTotal === 1 ? "hotspot" : "hotspots"}
                        </p>
                        {ic && ic.total > 0 && (
                          <div className="flex flex-wrap items-center gap-2.5 mt-1.5">
                            {[
                              { label: "Major", count: ic.major, color: SEVERITY_COLORS.Major },
                              { label: "Minor", count: ic.minor, color: SEVERITY_COLORS.Minor },
                              { label: "Cosmetic", count: ic.cosmetic, color: SEVERITY_COLORS.Cosmetic },
                            ]
                              .filter((s) => s.count > 0)
                              .map((s) => (
                                <span
                                  key={s.label}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600"
                                >
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: s.color }}
                                  />
                                  {s.count}
                                </span>
                              ))}
                          </div>
                        )}
                        {fp.tags?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {fp.tags.map((t: any) => (
                              <span
                                key={t.tagValueId}
                                className="inline-block rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                              >
                                {t.value}
                              </span>
                            ))}
                          </div>
                        )}
                        <p className="text-[11.5px] text-slate-400 mt-2 flex items-center gap-1.5">
                          <Clock className="h-3 w-3" />
                          {fp.createdAt
                            ? new Date(fp.createdAt).toLocaleDateString(
                                "en-US",
                                {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                }
                              )
                            : "—"}
                        </p>
                      </div>
                    </div>
                  );
                })}
                </div>
                {hasMoreCaptures && (
                  <div className="flex justify-center mt-6">
                    <Button
                      variant="outline"
                      onClick={() => setVisibleCount((v) => v + CAPTURES_PAGE_SIZE)}
                    >
                      Load More ({filteredCaptures.length - visibleCount} remaining)
                    </Button>
                  </div>
                )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {burstMode && burstCount > 0
                ? `Add Capture — ${burstCount} captured here`
                : "Add Capture"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Upload a site photo with an optional title and tags.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Title (optional)</Label>
              <Input
                id="title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Ground Floor Layout"
              />
            </div>
            <div>
              <Label htmlFor="file">
                Photo{selectedFiles.length > 1 ? "s" : ""}
              </Label>
              <Input
                id="file"
                type="file"
                ref={fileInputRef}
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={handleFileSelect}
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Select several at once to import a batch already taken with
                your camera — they'll all get the same tags below.
              </p>
            </div>
            {previewUrl ? (
              <div className="aspect-4/3 bg-slate-100 rounded-md overflow-hidden">
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="w-full h-full object-contain"
                  loading="lazy"
                />
              </div>
            ) : selectedFiles.length > 1 ? (
              <p className="text-sm text-slate-600 bg-slate-50 rounded-md px-3 py-2">
                {selectedFiles.length} photos selected
              </p>
            ) : null}

            {/* ── Tags: Block/Floor/Flat/Amenity, none required. Values
                stay pre-filled from your last capture (sticky) so you don't
                re-tag every photo in the same spot. ── */}
            <div>
              <Label>Tags (optional)</Label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {TAG_CATEGORIES.map(({ key, label }) => (
                  <TagSelect
                    key={key}
                    label={label}
                    values={tagsByCategory[key]}
                    selectedId={selectedTagIds[key] ?? null}
                    placeholder={label}
                    onChange={(id) =>
                      setSelectedTagIds((prev) => ({
                        ...prev,
                        [key]: id ?? undefined,
                      }))
                    }
                    onCreate={async (value) => {
                      const created = await api.createTagValue(projectId!, {
                        category: key,
                        value,
                      });
                      queryClient.invalidateQueries({
                        queryKey: ["tagValues", projectId],
                      });
                      return created;
                    }}
                  />
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={is360Upload}
                onChange={(e) => setIs360Upload(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">
                This is a 360° panorama image
              </span>
            </label>

            {/* ── Burst mode: tag once, keep shooting — no dialog
                interruption between shots until you tap Done. ── */}
            <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2.5">
              <input
                type="checkbox"
                checked={burstMode}
                onChange={(e) => setBurstMode(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">
                <span className="font-medium">Stay here</span> — keep this
                dialog open after each upload so I can add several photos in a
                row without re-tagging
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsUploadOpen(false);
                setNewTitle("");
                setSelectedFiles([]);
                setPreviewUrl(null);
                setIs360Upload(false);
                setBurstMode(false);
                setBurstCount(0);
              }}
            >
              {burstMode && burstCount > 0 ? "Done" : "Cancel"}
            </Button>
            <Button
              onClick={() => uploadMutation.mutate()}
              disabled={selectedFiles.length === 0 || uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ImageUp className="h-4 w-4 mr-2" />
              )}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New Visit ── */}
      <Dialog
        open={isNewVisitOpen}
        onOpenChange={(open) => {
          setIsNewVisitOpen(open);
          if (!open) setOpenCameraAfterVisit(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {currentVisit ? "Start a new visit" : "Name this visit"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Name the inspection round new captures will belong to.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-slate-500">
              {currentVisit
                ? "Everything you capture from now on goes under this new visit — your existing captures stay exactly where they are."
                : "This is your first capture on this project. Give this inspection round a name — e.g. \"Initial Inspection\"."}
            </p>
            <Label htmlFor="visit-title">Visit name</Label>
            <Input
              id="visit-title"
              autoFocus
              value={newVisitTitle}
              onChange={(e) => setNewVisitTitle(e.target.value)}
              placeholder="e.g. Initial Inspection"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newVisitTitle.trim())
                  createVisitMutation.mutate(newVisitTitle.trim());
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsNewVisitOpen(false);
                setOpenCameraAfterVisit(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createVisitMutation.mutate(newVisitTitle.trim())}
              disabled={!newVisitTitle.trim() || createVisitMutation.isPending}
            >
              {createVisitMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CalendarPlus className="h-4 w-4 mr-2" />
              )}
              Start Visit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk-apply tags to every untagged capture ── */}
      <Dialog open={isBulkTagOpen} onOpenChange={setIsBulkTagOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tag {untaggedCount} untagged captures</DialogTitle>
            <DialogDescription className="sr-only">
              Pick tags to apply to every untagged capture in this project.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-slate-500">
            These tags will be added to every untagged capture in this
            project. Existing tags on other captures aren't affected.
          </p>
          <div className="flex flex-wrap gap-2">
            {TAG_CATEGORIES.map(({ key, label }) => (
              <TagSelect
                key={key}
                label={label}
                values={tagsByCategory[key]}
                selectedId={bulkTagIds[key] ?? null}
                placeholder={label}
                onChange={(id) =>
                  setBulkTagIds((prev) => ({ ...prev, [key]: id ?? undefined }))
                }
                onCreate={async (value) => {
                  const created = await api.createTagValue(projectId!, {
                    category: key,
                    value,
                  });
                  queryClient.invalidateQueries({
                    queryKey: ["tagValues", projectId],
                  });
                  return created;
                }}
              />
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkTagOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => bulkTagMutation.mutate()}
              disabled={
                Object.values(bulkTagIds).filter(Boolean).length === 0 ||
                bulkTagMutation.isPending
              }
            >
              {bulkTagMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CheckSquare className="h-4 w-4 mr-2" />
              )}
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit tags on a single capture (tag it later) ── */}
      <Dialog
        open={!!tagEditCapture}
        onOpenChange={(open) => {
          if (!open) {
            setTagEditCapture(null);
            setTagEditIds({});
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tag capture</DialogTitle>
            <DialogDescription className="sr-only">
              Edit the block, floor, flat, and amenity tags on this capture.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-slate-500">
            {tagEditCapture?.title ?? ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {TAG_CATEGORIES.map(({ key, label }) => (
              <TagSelect
                key={key}
                label={label}
                values={tagsByCategory[key]}
                selectedId={tagEditIds[key] ?? null}
                placeholder={label}
                onChange={(id) =>
                  setTagEditIds((prev) => ({ ...prev, [key]: id ?? undefined }))
                }
                onCreate={async (value) => {
                  const created = await api.createTagValue(projectId!, {
                    category: key,
                    value,
                  });
                  queryClient.invalidateQueries({
                    queryKey: ["tagValues", projectId],
                  });
                  return created;
                }}
              />
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setTagEditCapture(null);
                setTagEditIds({});
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                tagEditCapture &&
                tagEditMutation.mutate({
                  id: tagEditCapture.id,
                  tagValueIds: Object.values(tagEditIds).filter(
                    Boolean
                  ) as string[],
                })
              }
              disabled={tagEditMutation.isPending}
            >
              {tagEditMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Tags className="h-4 w-4 mr-2" />
              )}
              Save Tags
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!renameCapture}
        onOpenChange={(open) => {
          if (!open) setRenameCapture(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename capture</DialogTitle>
            <DialogDescription className="sr-only">
              Give this capture a new title.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            placeholder="Capture title"
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameTitle.trim())
                renameMutation.mutate({
                  id: renameCapture.id,
                  title: renameTitle.trim(),
                });
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameCapture(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                renameCapture &&
                renameMutation.mutate({
                  id: renameCapture.id,
                  title: renameTitle.trim(),
                })
              }
              disabled={renameMutation.isPending || !renameTitle.trim()}
            >
              {renameMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Pencil className="h-4 w-4 mr-2" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Capture?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this capture and all its hotspots.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
