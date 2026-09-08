import { useState, useRef, useCallback } from "react";
import { Download } from "lucide-react";
import Layout from "@/components/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ReportDimension, ChecklistItem, Issue, ProgressLog } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";

const openImageInNewTab = (src: string) => {
  window.open(src, "_blank");
};


import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Plus,
  Printer,
  FileText,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Circle,
  X,
  Image as ImageIcon,
  ChevronDown,
  ChevronRight,
  Ruler,
  SquareStack,
  Calculator,
  RefreshCw,
  Loader2,
  Pencil,
} from "lucide-react";
import { Link, useRoute } from "wouter";
import NotFound from "./not-found";
import { useReactToPrint } from "react-to-print";
import { cn, compressImageFile } from "@/lib/utils";
import ReportPreview from "@/pages/ReportPreview";
import IssuesView from "@/components/IssuesView";
import {
  buildDimensionsFromChecklist,
  DEFAULT_DIMENSION_UNIT,
} from "@/lib/defaultChecklist";
import { useAuth } from "@/lib/auth";

export default function ReportEditor() {
  const [match, params] = useRoute("/report/:id");
  const { data: teamMembers = [] } = useQuery({
    queryKey: ["team"],
    queryFn: () => api.getTeam(),
  });
  const queryClient = useQueryClient();
  const { user, workspace } = useAuth();
  const isViewer = user?.role === "viewer";
  const [viewMode, setViewMode] = useState<
    "checklist" | "dimensions" | "issues" | "progress" | "preview"
  >("checklist");
  const [pdfMode, setPdfMode] = useState<"initial" | "progress" | "completion">("initial");
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState<Issue | null>(null);
  const [formData, setFormData] = useState<{
    title: string;
    note: string;
    location: string;
    responsibleEngineer: string;
    severity: "Low" | "Medium" | "High" | "Critical";
    status: "Open" | "In Progress" | "Resolved";
    images: string[];
  }>({
    title: "",
    note: "",
    location: "",
    responsibleEngineer: "",
    severity: "Low",
    status: "Open",
    images: [],
  });
  const componentRef = useRef<HTMLDivElement>(null);
  const checklistRef = useRef<ChecklistItem[]>([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingDataRef = useRef<any>(null);
  const checklistInitialized = useRef(false);

  const {
    data: report,
    isLoading,
  } = useQuery({
    queryKey: ["report", params?.id],
    queryFn: () => api.getReport(params!.id),
    enabled: !!params?.id,
  });

  const { data: project } = useQuery({
    queryKey: ["project", report?.projectId],
    queryFn: () => api.getProject(report!.projectId),
    enabled: !!report?.projectId,
  });

  const { data: progressLogs = [] } = useQuery({
    queryKey: ["progress-logs", params?.id],
    queryFn: () => api.getProgressLogs(params!.id),
    enabled: !!params?.id && viewMode === "preview",
  });

  // Initialize ref once on report load; never overwrite from server after that
  // (updateChecklistItem is the sole writer once editing begins)
  if (report?.checklist && !checklistInitialized.current) {
    checklistRef.current = report.checklist;
    checklistInitialized.current = true;
  }

  const saveMutation = useMutation({
    mutationFn: (data: any) => api.updateReport(params!.id, data),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ["report", params?.id] });
      const previous = queryClient.getQueryData(["report", params?.id]);
      queryClient.setQueryData(["report", params?.id], (old: any) => ({
        ...old,
        ...data,
      }));
      return { previous };
    },
    onError: (_err, _data, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["report", params?.id], context.previous);
      }
    },
    onSuccess: (updated: any) => {
      queryClient.setQueryData(["report", params?.id], updated);
    },
    onSettled: () => {
      // After mutation completes, send any pending data that accumulated during the save
      if (pendingDataRef.current) {
        debounceTimerRef.current = setTimeout(flushSave, 300);
      }
    },
  });

  const flushSave = useCallback(() => {
    const data = pendingDataRef.current;
    if (!data) return;
    if (saveMutation.isPending) {
      // Still saving from another trigger, try again later
      debounceTimerRef.current = setTimeout(flushSave, 300);
      return;
    }
    pendingDataRef.current = null;
    saveMutation.mutate(data);
  }, [saveMutation]);

  // Debounced save: coalesces rapid changes, then sends (never while another save is in flight)
  const saveReport = useCallback(
    (data: any) => {
      pendingDataRef.current = data;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(flushSave, 300);
    },
    [flushSave],
  );

  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: report ? `${report.title} - ${report.id}` : "Inspection Report",
  });

  const openNewIssueSheet = () => {
    setEditingIssue(null);
    setFormData({
      title: "",
      note: "",
      location: "",
      responsibleEngineer: report.author,
      severity: "Low",
      status: "Open",
      images: [],
    });
    setIsSheetOpen(true);
  };

  const openEditIssueSheet = (issue: Issue) => {
    setEditingIssue(issue);
    setFormData({
      title: issue.title,
      note: issue.note,
      location: issue.location,
      responsibleEngineer: issue.responsibleEngineer,
      severity: issue.severity,
      status: issue.status,
      images: issue.images,
    });
    setIsSheetOpen(true);
  };

  const handleAddImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || formData.images.length >= 3) return;
    try {
      const { dataUrl } = await compressImageFile(file);
      setFormData({
        ...formData,
        images: [...formData.images, dataUrl],
      });
    } catch {
      // compression failed — skip silently, user can retry
    }
    e.target.value = "";
  };

  const handleRemoveImage = (index: number) => {
    setFormData({
      ...formData,
      images: formData.images.filter((_, i) => i !== index),
    });
  };

  const handleSaveIssue = () => {
    if (!formData.title || !formData.note || formData.images.length === 0)
      return;

    const currentIssues = report.issues ?? [];
    if (editingIssue) {
      const updatedIssues = currentIssues.map((issue: Issue) =>
        issue.id === editingIssue.id ? { ...issue, ...formData } : issue,
      );
      saveReport({ issues: updatedIssues });
    } else {
      const newIssue: Issue = {
        ...formData,
        id: `issue-${Date.now()}`,
        reportId: report.id,
        createdAt: new Date().toISOString(),
      };
      saveReport({ issues: [...currentIssues, newIssue] });
    }
    setIsSheetOpen(false);
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "Critical":
        return "text-red-600 bg-red-50 border-red-200";
      case "High":
        return "text-orange-600 bg-orange-50 border-orange-200";
      case "Medium":
        return "text-amber-600 bg-amber-50 border-amber-200";
      default:
        return "text-slate-600 bg-slate-50 border-slate-200";
    }
  };

  if (!match || !params) return <NotFound />;
  if (isLoading)
    return (
      <Layout>
        <div className="flex items-center justify-center h-full text-muted-foreground p-8">
          Loading report...
        </div>
      </Layout>
    );
  if (!report) return <NotFound />;

  const dimensionUnit = report.dimensionUnit ?? DEFAULT_DIMENSION_UNIT;
  const dimensionRows = buildDimensionsFromChecklist(
    report.checklist ?? [],
    report.dimensions ?? [],
    dimensionUnit,
  );
  const measuredDimensionRows = dimensionRows.filter(
    (d) => Number(d.length) > 0 && Number(d.width) > 0,
  );

  const getAreaInSquareFeet = (d: ReportDimension) => {
    const l = Number(d.length),
      w = Number(d.width);
    if (!Number.isFinite(l) || !Number.isFinite(w) || l <= 0 || w <= 0)
      return 0;
    return d.unit === "m" ? l * w * 10.7639 : l * w;
  };

  const formatArea = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return "—";
    return new Intl.NumberFormat("en-IN", {
      maximumFractionDigits: value >= 100 ? 0 : 2,
    }).format(value);
  };

  const totalAreaSqFt = measuredDimensionRows.reduce(
    (sum, d) => sum + getAreaInSquareFeet(d),
    0,
  );
  const totalAreaSqM = totalAreaSqFt / 10.7639;

  const updateDimensionField = (
    dimensionId: string,
    field: keyof ReportDimension,
    value: string,
  ) => {
    const next = dimensionRows.map((d) =>
      d.id === dimensionId ? { ...d, [field]: value } : d,
    );
    saveReport({ dimensions: next });
  };

  const updateDefaultUnit = (nextUnit: "ft" | "m") => {
    const next = dimensionRows.map((d) => ({ ...d, unit: nextUnit }));
    saveReport({ dimensionUnit: nextUnit, dimensions: next });
  };

  const updateChecklistItem = (
    itemId: string,
    updates: Partial<ChecklistItem>,
  ) => {
    const next = checklistRef.current.map((c: ChecklistItem) =>
      c.id === itemId ? { ...c, ...updates } : c,
    );
    checklistRef.current = next;
    saveReport({ checklist: next });
  };

  const categories: string[] = Array.from(
    new Set((report.checklist ?? []).map((c: ChecklistItem) => c.category)),
  );
  const spaceNameMap = new Map(
    dimensionRows.map((d) => [d.space, d.spaceName || d.space]),
  );

  return (
    <Layout>
      {isViewer && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 md:px-6 py-2 text-xs text-amber-800 font-medium text-center shrink-0">
          You are viewing this report in read-only mode.
        </div>
      )}
      <div className="flex h-screen flex-col bg-background">
        {/* Header Toolbar */}
        <div className="border-b border-border bg-white px-4 md:px-6 py-3 flex flex-col lg:flex-row items-start lg:items-center justify-between shrink-0 gap-4 z-10">
          <div className="flex items-center gap-2 md:gap-4 w-full lg:w-auto">
            <Link href={`/project/${report.projectId}`}>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground shrink-0 h-8 w-8"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="text-base md:text-xl font-bold text-foreground flex items-center gap-2 truncate">
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">{report.title}</span>
              </h1>
              <p className="text-[10px] md:text-xs text-muted-foreground">
                {
                  (report.checklist ?? []).filter(
                    (c: ChecklistItem) => c.status === "N",
                  ).length
                }{" "}
                Failures • {report.status}
                {saveMutation.isPending && " • Saving..."}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2 w-full lg:w-auto justify-between lg:justify-end">
            <div className="bg-muted p-1 rounded-lg flex items-center shrink-0 w-full sm:w-auto">
              {(["checklist", "dimensions", "issues", "progress", "preview"] as const).map(
                (mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    data-testid={`button-tab-${mode}`}
                    className={cn(
                      "flex-1 sm:flex-none px-3 md:px-4 py-1.5 md:py-2 text-xs md:text-sm font-medium rounded-md transition-all capitalize",
                      viewMode === mode
                        ? "bg-white text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    {mode === "issues" && (report.issues?.length ?? 0) > 0 && (
                      <span className="ml-1.5 bg-primary/10 text-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {report.issues.length}
                      </span>
                    )}
                  </button>
                ),
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePrint()}
              className="h-9 md:h-10 text-xs md:text-sm px-3 md:px-4"
            >
              <Printer className="mr-2 h-3.5 w-3.5 md:h-4 md:w-4" /> Export PDF
            </Button>
            {!isViewer && (
            <Button
              size="sm"
              onClick={openNewIssueSheet}
              disabled={viewMode === "preview" || viewMode === "progress"}
              className="h-9 md:h-10 text-xs md:text-sm px-3 md:px-4"
            >
              <Plus className="mr-2 h-3.5 w-3.5 md:h-4 md:w-4" /> Add Issue
            </Button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden bg-muted/10">
          {viewMode === "preview" ? (
            <div className="h-full overflow-y-auto p-4 md:p-8 bg-slate-200/50 flex flex-col items-center print:p-0 print:bg-white print:overflow-visible">
              {/* PDF Mode Selector */}
              <div className="bg-white rounded-lg border shadow-sm p-1 flex items-center gap-1 mb-4 print:hidden">
                {(["initial", "progress", "completion"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setPdfMode(mode)}
                    className={cn(
                      "px-4 py-1.5 text-xs font-medium rounded-md transition-all",
                      pdfMode === mode
                        ? "bg-primary text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {mode === "initial" ? "Initial Inspection" : mode === "progress" ? "Progress Report" : "Completion Report"}
                  </button>
                ))}
              </div>
              <div
                ref={componentRef}
                className="bg-white shadow-xl w-full max-w-[210mm] min-h-[297mm] p-0 print:shadow-none print:m-0 print:max-w-none origin-top transition-transform sm:scale-100"
              >
                <div className="sm:hidden text-center py-4 bg-amber-50 text-amber-800 text-xs font-medium border-b border-amber-100 print:hidden">
                  Note: Preview layout is optimized for Desktop/A4 Print.
                </div>
                {project && (
                  <ReportPreview
                    report={report}
                    project={project}
                    companyProfile={{
                      name: workspace?.name || "",
                      logoUrl: workspace?.logoUrl,
                      address: workspace?.address,
                      email: workspace?.email,
                    }}
                    progressLogs={progressLogs}
                    pdfMode={pdfMode}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="h-full p-4 md:p-8 overflow-y-auto">
              <div className="max-w-5xl mx-auto space-y-4 md:space-y-6">
                {viewMode === "dimensions" ? (
                  <DimensionsView
                    dimensionUnit={dimensionUnit}
                    dimensionRows={dimensionRows}
                    measuredDimensionRows={measuredDimensionRows}
                    totalAreaSqFt={totalAreaSqFt}
                    totalAreaSqM={totalAreaSqM}
                    formatArea={formatArea}
                    updateDimensionField={updateDimensionField}
                    updateDefaultUnit={updateDefaultUnit}
                    readOnly={isViewer}
                  />
                ) : viewMode === "issues" ? (
                  <IssuesView
                    report={report}
                    openEditIssueSheet={openEditIssueSheet}
                    saveReport={saveReport}
                    readOnly={isViewer}
                  />
                ) : viewMode === "progress" ? (
                  <ProgressView
                    report={report}
                    readOnly={isViewer}
                    updateChecklistItem={updateChecklistItem}
                  />
                ) : (
                  <ChecklistView
                    report={report}
                    categories={categories}
                    spaceNameMap={spaceNameMap}
                    updateChecklistItem={updateChecklistItem}
                    readOnly={isViewer}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Dialogs and Sheets */}
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetContent className="sm:max-w-lg overflow-y-auto">
            <SheetHeader>
              <SheetTitle>
                {editingIssue ? "Edit Issue" : "Add New Issue"}
              </SheetTitle>
              <SheetDescription>
                {editingIssue
                  ? "Update issue details below."
                  : "Fill in the details to report a new issue."}
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="issue-title">Title</Label>
                <Input
                  id="issue-title"
                  value={formData.title}
                  onChange={(e) =>
                    setFormData({ ...formData, title: e.target.value })
                  }
                  placeholder="Brief issue title"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="issue-note">Note</Label>
                <Textarea
                  id="issue-note"
                  value={formData.note}
                  onChange={(e) =>
                    setFormData({ ...formData, note: e.target.value })
                  }
                  placeholder="Describe the issue in detail"
                  className="min-h-25"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="issue-location">Location</Label>
                <Input
                  id="issue-location"
                  value={formData.location}
                  onChange={(e) =>
                    setFormData({ ...formData, location: e.target.value })
                  }
                  placeholder="Where is this issue located?"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="issue-engineer">Responsible Engineer</Label>
                <Input
                  id="issue-engineer"
                  value={formData.responsibleEngineer}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      responsibleEngineer: e.target.value,
                    })
                  }
                  placeholder="Enter engineer name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="issue-severity">Severity</Label>
                  <Select
                    value={formData.severity}
                    onValueChange={(val: any) =>
                      setFormData({ ...formData, severity: val })
                    }
                  >
                    <SelectTrigger id="issue-severity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Low">Low</SelectItem>
                      <SelectItem value="Medium">Medium</SelectItem>
                      <SelectItem value="High">High</SelectItem>
                      <SelectItem value="Critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="issue-status">Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(val: any) =>
                      setFormData({ ...formData, status: val })
                    }
                  >
                    <SelectTrigger id="issue-status">
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
              <div className="grid gap-2">
                <Label>Images (max 3)</Label>
                <input
                  type="file"
                  accept="image/*"
                  id="issue-file-upload"
                  className="hidden"
                  onChange={handleAddImage}
                />
                <Label
                  htmlFor="issue-file-upload"
                  className="inline-flex items-center gap-2 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors w-full sm:w-auto justify-center"
                >
                  <ImageIcon className="h-3.5 w-3.5" /> Upload Image
                </Label>
                <div className="flex gap-2 flex-wrap mt-2">
                  {formData.images.map((img, idx) => (
                    <div
                      key={idx}
                      className="relative h-16 w-16 rounded border overflow-hidden group"
                    >
                      <img
                        src={img}
                        alt="Issue"
                        className="object-cover w-full h-full"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-100 md:opacity-0 md:group-hover:opacity-100 flex items-center justify-center gap-1 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleRemoveImage(idx);
                          }}
                        >
                          <X className="h-4 w-4 text-white" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <SheetFooter>
              <SheetClose asChild>
                <Button variant="outline">Cancel</Button>
              </SheetClose>
              <Button
                onClick={handleSaveIssue}
                disabled={
                  !formData.title ||
                  !formData.note ||
                  formData.images.length === 0
                }
              >
                {editingIssue ? "Update Issue" : "Save Issue"}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </Layout>
  );
}

// ─── Checklist View ───────────────────────────────────────────────────────────

function ChecklistView({
  report,
  categories,
  spaceNameMap,
  updateChecklistItem,
  readOnly = false,
}: {
  report: any;
  categories: string[];
  spaceNameMap: Map<string, string>;
  updateChecklistItem: (id: string, updates: Partial<ChecklistItem>) => void;
  readOnly?: boolean;
}) {
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, boolean>
  >(
    categories.reduce(
      (acc, cat, idx) => ({ ...acc, [cat]: idx === 0 }),
      {} as Record<string, boolean>,
    ),
  );

  const toggleCategory = (cat: string) =>
    setExpandedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));

  const checklist: ChecklistItem[] = report.checklist ?? [];
  const yes = checklist.filter((c) => c.status === "Y").length;
  const no = checklist.filter((c) => c.status === "N").length;
  const pending = checklist.filter((c) => c.status === null).length;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-primary" /> Inspection Checklist
        </h2>
        <div className="text-sm text-muted-foreground bg-white px-3 py-1 rounded-full border shadow-sm">
          {yes} Yes / {no} No / {pending} Pending
        </div>
      </div>

      <div className="flex gap-4 mb-6 p-4 bg-white rounded-xl border shadow-sm">
        <div className="flex flex-col">
          <span className="text-xs text-slate-500 uppercase font-semibold">
            Total Major
          </span>
          <span className="text-xl font-bold text-red-600">
            {
              checklist.filter(
                (c) => c.status === "N" && c.severity === "MAJOR",
              ).length
            }
          </span>
        </div>
        <div className="w-px bg-slate-200"></div>
        <div className="flex flex-col">
          <span className="text-xs text-slate-500 uppercase font-semibold">
            Total Minor
          </span>
          <span className="text-xl font-bold text-orange-500">
            {
              checklist.filter(
                (c) => c.status === "N" && c.severity === "MINOR",
              ).length
            }
          </span>
        </div>
        <div className="w-px bg-slate-200"></div>
        <div className="flex flex-col">
          <span className="text-xs text-slate-500 uppercase font-semibold">
            Total Cosmetic
          </span>
          <span className="text-xl font-bold text-blue-500">
            {
              checklist.filter(
                (c) => c.status === "N" && c.severity === "COSMETIC",
              ).length
            }
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        {categories.map((category, catIdx) => (
          <div
            key={category}
            className={catIdx > 0 ? "border-t border-slate-100" : ""}
          >
            <div
              className="bg-slate-50 px-4 py-3 font-semibold text-sm border-b border-slate-100 text-slate-700 flex justify-between items-center cursor-pointer hover:bg-slate-100 transition-colors"
              onClick={() => toggleCategory(category)}
            >
              <div className="flex items-center gap-2">
                {expandedCategories[category] ? (
                  <ChevronDown className="h-4 w-4 text-slate-500" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-slate-500" />
                )}
                {spaceNameMap.get(category) || category}
              </div>
              <div className="flex gap-2 text-xs font-normal">
                <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                  {
                    checklist.filter(
                      (c) => c.category === category && c.status === "Y",
                    ).length
                  }{" "}
                  Yes
                </span>
                <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                  {
                    checklist.filter(
                      (c) => c.category === category && c.status === "N",
                    ).length
                  }{" "}
                  No
                </span>
              </div>
            </div>

            {expandedCategories[category] && (
              <div className="divide-y divide-slate-100">
                {checklist
                  .filter((c) => c.category === category)
                  .map((item) => (
                    <ChecklistItemRow
                      key={item.id}
                      item={item}
                      index={checklist.indexOf(item)}
                      update={updateChecklistItem}
                      readOnly={readOnly}
                    />
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function ChecklistItemRow({
  item,
  index,
  update,
  readOnly = false,
}: {
  item: ChecklistItem;
  index: number;
  update: (id: string, updates: Partial<ChecklistItem>) => void;
  readOnly?: boolean;
}) {
  const [isReadingFile, setIsReadingFile] = useState(false);

  const handleYes = () => {
    if (readOnly) return;
    if (item.status === "Y")
      update(item.id, { status: null, severity: null, image: undefined, workStatus: null });
    else update(item.id, {
      status: "Y",
      severity: null,
      image: undefined,
      workStatus: item.triggerOn === "yes" ? "open" : undefined,
    });
  };

  const handleNo = () => {
    if (readOnly) return;
    if (item.status === "N")
      update(item.id, { status: null, severity: null, image: undefined, workStatus: null });
    else update(item.id, {
      status: "N",
      workStatus: item.triggerOn !== "yes" ? "open" : undefined,
    });
  };

  const isTriggerIssue =
    item.triggerOn === "yes" ? item.status === "Y" : item.status === "N";

  const yesColor =
    item.triggerOn === "yes"
      ? item.status === "Y"
        ? "bg-red-500 text-white"
        : "bg-green-500 text-white"
      : item.status === "Y"
        ? "bg-green-500 text-white"
        : "bg-red-500 text-white";

  const noColor =
    item.triggerOn === "yes"
      ? item.status === "N"
        ? "bg-green-500 text-white"
        : "bg-yellow-500 text-white"
      : item.status === "N"
        ? "bg-red-500 text-white"
        : "bg-yellow-500 text-white";

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsReadingFile(true);
    try {
      const { dataUrl } = await compressImageFile(file);
      update(item.id, { image: dataUrl });
    } catch {
      // compression failed — user can retry
    }
    setIsReadingFile(false);
  };

  return (
    <div className="p-3 md:p-4 flex flex-col md:flex-row gap-3 md:gap-4 md:items-center hover:bg-slate-50/50 transition-colors">
      <div className="flex-1 flex items-start gap-3">
        <div className="mt-0.5 w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center shrink-0 text-[10px] text-slate-400 font-medium">
          {index + 1}
        </div>
        <p className="text-sm md:text-base font-medium leading-tight">
          {item.point}
        </p>
      </div>

      <div className="flex flex-col gap-2 pl-8 md:pl-0 shrink-0 w-full sm:w-auto mt-2 md:mt-0">
        <div className="flex flex-wrap items-center gap-2 justify-start md:justify-end">
          <div className="flex bg-slate-100 rounded-lg p-1 border">
            <button
              className={cn(
                "px-3 py-1 text-xs font-bold rounded-md transition-all duration-200",
                item.status === "Y"
                  ? yesColor
                  : "text-slate-500 hover:text-slate-700",
              )}
              onClick={handleYes}
              data-testid={`button-yes-${item.id}`}
            >
              YES
            </button>
            <button
              className={cn(
                "px-3 py-1 text-xs font-bold rounded-md transition-all duration-200",
                item.status === "N"
                  ? noColor
                  : "text-slate-500 hover:text-slate-700",
              )}
              onClick={handleNo}
              data-testid={`button-no-${item.id}`}
            >
              NO
            </button>
          </div>

          {isTriggerIssue && (
            <>
              <select
                className="text-xs border rounded-md px-2 py-1.5 bg-white text-slate-700 w-full sm:w-[110px]"
                value={item.severity || "invalid"}
                onChange={(e) => {
                  if (readOnly) return;
                  update(item.id, { severity: (e.target.value || null) as any });
                }}
                disabled={readOnly}
                data-testid={`select-severity-${item.id}`}
              >
                <option value="invalid" disabled>
                  Severity
                </option>
                <option value="MAJOR">Major</option>
                <option value="MINOR">Minor</option>
                <option value="COSMETIC">Cosmetic</option>
              </select>
              <select
                className={cn(
                  "text-xs border rounded-md px-2 py-1.5 w-full sm:w-[120px] font-medium",
                  item.workStatus === "resolved"
                    ? "bg-green-50 text-green-700 border-green-200"
                    : item.workStatus === "in_progress"
                      ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                      : "bg-red-50 text-red-700 border-red-200",
                )}
                value={item.workStatus || "open"}
                onChange={(e) => {
                  if (readOnly) return;
                  update(item.id, { workStatus: e.target.value as any });
                }}
                disabled={readOnly}
                data-testid={`select-work-status-${item.id}`}
              >
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
              </select>
            </>
          )}
        </div>

        {(item.triggerOn === "yes"
          ? item.status === "Y"
          : item.status === "N") && (
          <div className="flex justify-start md:justify-end">
            {item.image ? (
              <div className="relative h-10 w-14 sm:h-12 sm:w-16 rounded border overflow-hidden group">
                <img
                  src={item.image}
                  alt="Defect"
                  className="object-cover w-full h-full"
                />
                <div className="absolute inset-0 bg-black/50 opacity-100 md:opacity-0 md:group-hover:opacity-100 flex items-center justify-center gap-1 transition-opacity">
                  <button
                    type="button"
                    className="p-1 cursor-pointer"
                    onClick={() => openImageInNewTab(item.image!)}
                  >
                    <Download className="h-4 w-4 text-white" />
                  </button>
                  {!readOnly && (
                  <button
                    type="button"
                    className="p-1 cursor-pointer"
                    onClick={() => update(item.id, { image: undefined })}
                  >
                    <X className="h-4 w-4 text-white" />
                  </button>
                  )}
                </div>
              </div>
            ) : !readOnly ? (
              <>
                <input
                  type="file"
                  id={`check-img-${item.id}`}
                  className="hidden"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                />
                <label
                  htmlFor={`check-img-${item.id}`}
                  className={cn(
                    "flex items-center justify-center gap-1 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors w-full sm:w-auto",
                    isReadingFile
                      ? "cursor-not-allowed opacity-70"
                      : "cursor-pointer",
                  )}
                >
                  {isReadingFile ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5" />
                  )}{" "}
                  {isReadingFile ? "Reading..." : "Add Photo"}
                </label>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dimensions View ──────────────────────────────────────────────────────────

function DimensionsView({
  dimensionUnit,
  dimensionRows,
  measuredDimensionRows,
  totalAreaSqFt,
  totalAreaSqM,
  formatArea,
  updateDimensionField,
  updateDefaultUnit,
  readOnly = false,
}: any) {
  return (
    <>
      <div className="rounded-[28px] border border-indigo-100 bg-linear-to-br from-white via-indigo-50/50 to-slate-50 p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-indigo-600">
              <Ruler className="h-3.5 w-3.5" /> Dimensions tab
            </div>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
              Area calculator for every report space
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Enter length and width for each room. We calculate total square
              feet instantly.
            </p>
          </div>
          <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:min-w-[220px]">
            <Label htmlFor="report-default-unit">Default unit</Label>
            <Select
              value={dimensionUnit}
              onValueChange={(value: "ft" | "m") => updateDefaultUnit(value)}
              disabled={readOnly}
            >
              <SelectTrigger
                id="report-default-unit"
                data-testid="select-dimension-default-unit"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ft">Feet</SelectItem>
                <SelectItem value="m">Meters</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">
              Changing this updates all room inputs.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="rounded-3xl border-indigo-100 bg-white/90 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600">
              <Calculator className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                Total area
              </p>
              <p
                className="text-2xl font-bold text-slate-900"
                data-testid="text-total-area-sqft"
              >
                {formatArea(totalAreaSqFt)} sq ft
              </p>
            </div>
          </div>
        </Card>
        <Card className="rounded-3xl border-slate-200 bg-white/90 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
              <SquareStack className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                Metric view
              </p>
              <p
                className="text-2xl font-bold text-slate-900"
                data-testid="text-total-area-sqm"
              >
                {formatArea(totalAreaSqM)} sq m
              </p>
            </div>
          </div>
        </Card>
        <Card className="rounded-3xl border-slate-200 bg-white/90 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600">
              <Ruler className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                Measured spaces
              </p>
              <p
                className="text-2xl font-bold text-slate-900"
                data-testid="text-measured-space-count"
              >
                {measuredDimensionRows.length} / {dimensionRows.length}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {dimensionRows.map((dimension: ReportDimension) => {
          const areaSqFt = (() => {
            const l = Number(dimension.length),
              w = Number(dimension.width);
            if (!Number.isFinite(l) || !Number.isFinite(w) || l <= 0 || w <= 0)
              return 0;
            return dimension.unit === "m" ? l * w * 10.7639 : l * w;
          })();
          const areaSqM = areaSqFt / 10.7639;

          return (
            <Card
              key={dimension.id}
              className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md md:p-6"
              data-testid={`card-dimension-${dimension.id}`}
            >
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-500">
                      Space
                    </p>
                    <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-400 transition-all">
                      <input
                        className="flex-1 text-xl font-semibold text-slate-900 bg-transparent outline-none"
                        defaultValue={dimension.spaceName ?? dimension.space}
                        onBlur={(e) => {
                          if (readOnly) return;
                          const val = e.target.value.trim();
                          if (!val) {
                            e.target.value = dimension.space;
                            updateDimensionField(
                              dimension.id,
                              "spaceName",
                              dimension.space,
                            );
                          } else {
                            updateDimensionField(
                              dimension.id,
                              "spaceName",
                              val,
                            );
                          }
                        }}
                        readOnly={readOnly}
                        data-testid={`text-dimension-space-${dimension.id}`}
                      />
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4 shrink-0 text-slate-300"
                      >
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      </svg>
                    </div>
                    {dimension.spaceName && dimension.spaceName !== dimension.space && (
                      <span className="mt-1.5 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                        {dimension.space}
                      </span>
                    )}
                  </div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                    Input in {dimension.unit === "ft" ? "ft" : "m"}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Length</Label>
                    <Input
                      inputMode="decimal"
                      placeholder={
                        dimension.unit === "ft" ? "e.g. 12.5" : "e.g. 3.8"
                      }
                      defaultValue={dimension.length}
                      onBlur={(e) => {
                        if (readOnly) return;
                        updateDimensionField(
                          dimension.id,
                          "length",
                          e.target.value,
                        );
                      }}
                      disabled={readOnly}
                      data-testid={`input-dimension-length-${dimension.id}`}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Width</Label>
                    <Input
                      inputMode="decimal"
                      placeholder={
                        dimension.unit === "ft" ? "e.g. 10" : "e.g. 3.2"
                      }
                      defaultValue={dimension.width}
                      onBlur={(e) => {
                        if (readOnly) return;
                        updateDimensionField(
                          dimension.id,
                          "width",
                          e.target.value,
                        );
                      }}
                      disabled={readOnly}
                      data-testid={`input-dimension-width-${dimension.id}`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="grid gap-2">
                    <Label>Notes</Label>
                    <Textarea
                      placeholder="Optional notes about this measurement"
                      className="min-h-22"
                      defaultValue={dimension.notes || ""}
                      onBlur={(e) => {
                        if (readOnly) return;
                        updateDimensionField(
                          dimension.id,
                          "notes",
                          e.target.value,
                        );
                      }}
                      disabled={readOnly}
                      data-testid={`input-dimension-notes-${dimension.id}`}
                    />
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                      Calculated area
                    </p>
                    <p
                      className="mt-3 text-2xl font-bold text-slate-900"
                      data-testid={`text-dimension-area-sqft-${dimension.id}`}
                    >
                      {formatArea(areaSqFt)} sq ft
                    </p>
                    <p
                      className="mt-1 text-sm text-slate-500"
                      data-testid={`text-dimension-area-sqm-${dimension.id}`}
                    >
                      {formatArea(areaSqM)} sq m
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ─── Progress: Item Status Row ────────────────────────────────────────────────

function ItemStatusRow({
  item,
  readOnly,
  onUpdate,
  onPhotoUpload,
  afterPhotos,
  onRemovePhoto,
  onResolve,
  isPendingResolve,
}: {
  item: ChecklistItem;
  readOnly: boolean;
  onUpdate: (id: string, updates: Partial<ChecklistItem>) => void;
  onPhotoUpload: (itemId: string, e: React.ChangeEvent<HTMLInputElement>) => void;
  afterPhotos: Record<string, string[]>;
  onRemovePhoto: (itemId: string, photoIdx: number) => void;
  onResolve: (itemId: string) => void;
  isPendingResolve: boolean;
}) {
  const statusColors = {
    open: "bg-red-100 text-red-700 border-red-200",
    in_progress: "bg-yellow-100 text-yellow-700 border-yellow-200",
    resolved: "bg-green-100 text-green-700 border-green-200",
  };

  const nextStatus: Record<string, string> = {
    open: "in_progress",
    in_progress: "resolved",
  };

  const nextLabel: Record<string, string> = {
    open: "Start Work",
    in_progress: "Mark Resolved",
  };

  const handleAdvance = () => {
    const next = nextStatus[item.workStatus || "open"];
    if (next === "resolved") {
      onResolve(item.id);
    } else {
      onUpdate(item.id, { workStatus: next as any });
    }
  };

  const handleConfirmResolve = () => {
    const photos = afterPhotos[item.id] || [];
    if (photos.length === 0) return;
    onUpdate(item.id, { workStatus: "resolved" });
  };

  const currentStatus = item.workStatus || "open";
  const itemPhotos = afterPhotos[item.id] || [];
  const showPhotoUpload = isPendingResolve && currentStatus !== "resolved";

  return (
    <div className={cn(
      "rounded-lg border transition-colors",
      currentStatus === "resolved"
        ? "bg-green-50/50 border-green-200"
        : currentStatus === "in_progress"
          ? "bg-yellow-50/50 border-yellow-200"
          : "bg-white border-slate-200",
    )}>
      <div className="flex items-center gap-3 p-3">
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-sm font-medium truncate",
            currentStatus === "resolved" && "line-through text-slate-500",
          )}>
            {item.point}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {item.severity && (
              <span className={cn(
                "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                item.severity === "MAJOR"
                  ? "bg-red-50 text-red-600"
                  : item.severity === "MINOR"
                    ? "bg-orange-50 text-orange-600"
                    : "bg-blue-50 text-blue-600",
              )}>
                {item.severity}
              </span>
            )}
            <span className={cn(
              "text-[10px] font-semibold px-1.5 py-0.5 rounded border",
              statusColors[currentStatus as keyof typeof statusColors],
            )}>
              {currentStatus === "in_progress" ? "In Progress" : currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1)}
            </span>
          </div>
        </div>

        {!readOnly && currentStatus !== "resolved" && !showPhotoUpload && (
          <Button
            size="sm"
            variant={currentStatus === "open" ? "default" : "outline"}
            onClick={handleAdvance}
            className="shrink-0 text-xs"
          >
            {nextLabel[currentStatus]}
          </Button>
        )}
      </div>

      {/* Inline photo upload when resolving */}
      {showPhotoUpload && (
        <div className="px-3 pb-3 border-t border-slate-100 pt-3">
          <p className="text-[10px] font-medium text-slate-500 mb-2">
            After photo required to mark as resolved:
          </p>
          <div className="flex gap-2 flex-wrap items-center">
            {itemPhotos.map((photo, pIdx) => (
              <div key={pIdx} className="relative h-14 w-14 rounded border overflow-hidden group">
                <img src={photo} alt="After" className="object-cover w-full h-full" />
                <button
                  type="button"
                  onClick={() => onRemovePhoto(item.id, pIdx)}
                  className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              </div>
            ))}
            {itemPhotos.length < 2 && (
              <>
                <input
                  type="file"
                  accept="image/*"
                  id={`resolve-after-${item.id}`}
                  className="hidden"
                  onChange={(e) => onPhotoUpload(item.id, e)}
                />
                <label
                  htmlFor={`resolve-after-${item.id}`}
                  className="flex items-center justify-center gap-1 h-14 w-14 border-2 border-dashed border-slate-300 rounded-lg text-slate-400 hover:border-primary hover:text-primary cursor-pointer transition-colors"
                >
                  <Plus className="h-3 w-3" />
                </label>
              </>
            )}
          </div>
          {itemPhotos.length === 0 && (
            <p className="text-[10px] text-red-500 mt-1">At least 1 photo required</p>
          )}
          <div className="flex gap-2 justify-end mt-3">
            <Button variant="outline" size="sm" onClick={() => onResolve("")} className="text-xs">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmResolve}
              disabled={itemPhotos.length === 0}
              className="text-xs"
            >
              Confirm Resolve
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Progress View ───────────────────────────────────────────────────────────

function ProgressView({
  report,
  readOnly = false,
  updateChecklistItem,
}: {
  report: any;
  readOnly?: boolean;
  updateChecklistItem: (id: string, updates: Partial<ChecklistItem>) => void;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editAfterPhotos, setEditAfterPhotos] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState("");
  const [resolvedIds, setResolvedIds] = useState<string[]>([]);
  const [afterPhotos, setAfterPhotos] = useState<Record<string, string[]>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [pendingResolveId, setPendingResolveId] = useState<string | null>(null);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["progress-logs", report.id],
    queryFn: () => api.getProgressLogs(report.id),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.createProgressLog(report.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["progress-logs", report.id] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.updateProgressLog(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["progress-logs", report.id] });
      setEditingLogId(null);
      setEditNotes("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProgressLog(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["progress-logs", report.id] });
      setDeleteConfirmId(null);
    },
  });

  const checklist: ChecklistItem[] = report.checklist ?? [];
  const failedItems = checklist.filter(
    (c) => (c.triggerOn === "yes" ? c.status === "Y" : c.status === "N"),
  );

  const openItems = failedItems.filter((c) => !c.workStatus || c.workStatus === "open");
  const inProgressItems = failedItems.filter((c) => c.workStatus === "in_progress");
  const resolvedItems = failedItems.filter((c) => c.workStatus === "resolved");

  const resolvedCount = resolvedItems.length;
  const progressPct =
    failedItems.length > 0
      ? Math.round((resolvedCount / failedItems.length) * 100)
      : 0;

  const resetForm = () => {
    setIsAdding(false);
    setResolvedIds([]);
    setAfterPhotos({});
    setNotes("");
    setPendingResolveId(null);
  };

  const handlePhotoUpload = async (itemId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { dataUrl } = await compressImageFile(file);
      setAfterPhotos((prev) => ({
        ...prev,
        [itemId]: [...(prev[itemId] || []), dataUrl],
      }));
    } catch {
      // compression failed — user can retry
    }
    e.target.value = "";
  };

  const removeAfterPhoto = (itemId: string, photoIdx: number) => {
    setAfterPhotos((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] || []).filter((_, i) => i !== photoIdx),
    }));
  };

  const canSubmit = resolvedIds.length > 0 || notes.trim();
  const allResolvedHavePhotos = resolvedIds.every(
    (id) => afterPhotos[id] && afterPhotos[id].length > 0,
  );

  const handleResolveSelected = () => {
    if (resolvedIds.length === 0 || !allResolvedHavePhotos) return;
    resolvedIds.forEach((id) => {
      updateChecklistItem(id, { workStatus: "resolved" });
    });
    createMutation.mutate({
      author: user?.name || "Inspector",
      date: new Date().toISOString().split("T")[0],
      notes: notes.trim() || undefined,
      resolvedChecklistItemIds: resolvedIds,
      afterPhotos: Object.fromEntries(
        Object.entries(afterPhotos).filter(([k]) => resolvedIds.includes(k)),
      ),
    });
  };

  const toggleResolved = (id: string) => {
    setResolvedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (!next.includes(id)) {
        setAfterPhotos((p) => { const n = { ...p }; delete n[id]; return n; });
      }
      return next;
    });
  };

  const startEditNotes = (log: any) => {
    setEditingLogId(log.id);
    setEditNotes(log.notes || "");
    setEditAfterPhotos(log.afterPhotos ? { ...log.afterPhotos } : {});
  };

  const saveEditNotes = () => {
    if (!editingLogId) return;
    updateMutation.mutate({
      id: editingLogId,
      data: {
        notes: editNotes.trim() || null,
        afterPhotos: Object.keys(editAfterPhotos).length > 0 ? editAfterPhotos : null,
      },
    });
  };

  const handleEditPhotoUpload = async (itemId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { dataUrl } = await compressImageFile(file);
      setEditAfterPhotos((prev) => ({
        ...prev,
        [itemId]: [...(prev[itemId] || []), dataUrl],
      }));
    } catch {
      // compression failed — user can retry
    }
    e.target.value = "";
  };

  const removeEditAfterPhoto = (itemId: string, photoIdx: number) => {
    setEditAfterPhotos((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] || []).filter((_, i) => i !== photoIdx),
    }));
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <RefreshCw className="h-5 w-5 text-primary" /> Progress
        </h2>
        {!readOnly && !isAdding && openItems.length + inProgressItems.length > 0 && (
          <Button size="sm" onClick={() => setIsAdding(true)}>
            <Plus className="mr-2 h-4 w-4" /> Resolve Items
          </Button>
        )}
      </div>

      {/* Summary Bar */}
      <div className="bg-white rounded-xl border shadow-sm p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-700">
            {resolvedCount} of {failedItems.length} items resolved
          </span>
          <span className="text-sm font-bold text-primary">{progressPct}%</span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-2.5">
          <div
            className="bg-primary h-2.5 rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {failedItems.length > 0 && (
          <div className="flex gap-3 mt-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              Open ({openItems.length})
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-yellow-500" />
              In Progress ({inProgressItems.length})
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Resolved ({resolvedItems.length})
            </span>
          </div>
        )}
      </div>

      {/* Resolve Items Form */}
      {isAdding && (
        <div className="bg-white rounded-xl border shadow-sm p-4 mb-6">
          <h3 className="font-semibold text-sm mb-3">Resolve Items</h3>
          {openItems.length + inProgressItems.length > 0 && (
            <div className="mb-4">
              <Label className="text-xs font-medium text-slate-600 mb-2 block">
                Select items to mark as resolved:
              </Label>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {[...openItems, ...inProgressItems].map((item) => {
                  const isChecked = resolvedIds.includes(item.id);
                  const itemPhotos = afterPhotos[item.id] || [];
                  return (
                    <div key={item.id} className="rounded-lg border border-slate-200 p-2">
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleResolved(item.id)}
                          className="rounded"
                        />
                        <span className="flex-1">{item.point}</span>
                        <span
                          className={cn(
                            "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                            item.severity === "MAJOR"
                              ? "bg-red-50 text-red-600"
                              : item.severity === "MINOR"
                                ? "bg-orange-50 text-orange-600"
                                : "bg-blue-50 text-blue-600",
                          )}
                        >
                          {item.severity || "NO SEVERITY"}
                        </span>
                        {item.workStatus === "in_progress" && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-600">
                            In Progress
                          </span>
                        )}
                      </label>
                      {isChecked && (
                        <div className="mt-2 pl-6">
                          <p className="text-[10px] text-slate-500 mb-1">
                            After photo required:
                          </p>
                          <div className="flex gap-2 flex-wrap items-center">
                            {itemPhotos.map((photo, pIdx) => (
                              <div key={pIdx} className="relative h-12 w-12 rounded border overflow-hidden group">
                                <img src={photo} alt="After" className="object-cover w-full h-full" />
                                <button
                                  type="button"
                                  onClick={(e) => { e.preventDefault(); removeAfterPhoto(item.id, pIdx); }}
                                  className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                                >
                                  <X className="h-3 w-3 text-white" />
                                </button>
                              </div>
                            ))}
                            {itemPhotos.length < 2 && (
                              <>
                                <input
                                  type="file"
                                  accept="image/*"
                                  id={`after-${item.id}`}
                                  className="hidden"
                                  onChange={(e) => handlePhotoUpload(item.id, e)}
                                />
                                <label
                                  htmlFor={`after-${item.id}`}
                                  className="flex items-center justify-center gap-1 h-12 w-12 border-2 border-dashed border-slate-300 rounded-lg text-slate-400 hover:border-primary hover:text-primary cursor-pointer transition-colors"
                                >
                                  <Plus className="h-3 w-3" />
                                </label>
                              </>
                            )}
                          </div>
                          {itemPhotos.length === 0 && (
                            <p className="text-[10px] text-red-500 mt-1">At least 1 photo required</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="grid gap-2 mb-4">
            <Label htmlFor="log-notes">Notes</Label>
            <Textarea
              id="log-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was done during this visit?"
              className="min-h-20"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={resetForm}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleResolveSelected}
              disabled={
                createMutation.isPending ||
                !canSubmit ||
                (resolvedIds.length > 0 && !allResolvedHavePhotos)
              }
            >
              {createMutation.isPending ? "Saving..." : "Save Entry"}
            </Button>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Log Entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this progress entry. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteConfirmId) deleteMutation.mutate(deleteConfirmId); }}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Item Status Sections */}
      {failedItems.length > 0 ? (
        <div className="space-y-6 mb-8">
          {openItems.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                Open ({openItems.length})
              </h3>
              <div className="space-y-2">
                {openItems.map((item) => (
                  <ItemStatusRow
                    key={item.id}
                    item={item}
                    readOnly={readOnly}
                    onUpdate={updateChecklistItem}
                    onPhotoUpload={handlePhotoUpload}
                    afterPhotos={afterPhotos}
                    onRemovePhoto={removeAfterPhoto}
                    onResolve={(id) => setPendingResolveId(id || null)}
                    isPendingResolve={pendingResolveId === item.id}
                  />
                ))}
              </div>
            </div>
          )}
          {inProgressItems.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-yellow-700 mb-2 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                In Progress ({inProgressItems.length})
              </h3>
              <div className="space-y-2">
                {inProgressItems.map((item) => (
                  <ItemStatusRow
                    key={item.id}
                    item={item}
                    readOnly={readOnly}
                    onUpdate={updateChecklistItem}
                    onPhotoUpload={handlePhotoUpload}
                    afterPhotos={afterPhotos}
                    onRemovePhoto={removeAfterPhoto}
                    onResolve={(id) => setPendingResolveId(id || null)}
                    isPendingResolve={pendingResolveId === item.id}
                  />
                ))}
              </div>
            </div>
          )}
          {resolvedItems.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                Resolved ({resolvedItems.length})
              </h3>
              <div className="space-y-2">
                {resolvedItems.map((item) => (
                  <ItemStatusRow
                    key={item.id}
                    item={item}
                    readOnly={readOnly}
                    onUpdate={updateChecklistItem}
                    onPhotoUpload={handlePhotoUpload}
                    afterPhotos={afterPhotos}
                    onRemovePhoto={removeAfterPhoto}
                    onResolve={(id) => setPendingResolveId(id || null)}
                    isPendingResolve={false}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-slate-400">
          <RefreshCw className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No failed items to track.</p>
        </div>
      )}

      {/* Timeline */}
      {!isLoading && logs.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-600 mb-3">Activity Log</h3>
          <div className="space-y-4">
            {logs.map((log: any) => {
              const isEditing = editingLogId === log.id;
              return (
                <div key={log.id} className="bg-white rounded-xl border shadow-sm p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                        {log.author?.charAt(0) || "?"}
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{log.author}</p>
                        <p className="text-[10px] text-slate-400">{log.date}</p>
                      </div>
                    </div>
                    {!readOnly && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-slate-400 hover:text-foreground"
                          onClick={() => startEditNotes(log)}
                          disabled={isEditing}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-slate-400 hover:text-red-500"
                          onClick={() => setDeleteConfirmId(log.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {log.resolvedChecklistItemIds?.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase text-slate-400 mb-1">Resolved</p>
                      <div className="space-y-1.5">
                        {log.resolvedChecklistItemIds.map((id: string) => {
                          const item = checklist.find((c) => c.id === id);
                          const photos = log.afterPhotos?.[id] ?? [];
                          return item ? (
                            <div key={id} className="flex items-center gap-2">
                              <span className="text-[11px] bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-200 shrink-0">
                                ✓ {item.point}
                              </span>
                              {photos.length > 0 && (
                                <div className="flex gap-1">
                                  {photos.map((p: string, i: number) => (
                                    <img
                                      key={i}
                                      src={p}
                                      alt="After"
                                      className="h-8 w-8 rounded border object-cover cursor-pointer hover:opacity-80"
                                      onClick={() => openImageInNewTab(p)}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : null;
                        })}
                      </div>
                    </div>
                  )}

                  {isEditing ? (
                    <div className="mt-3">
                      <Textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder="Notes..."
                        className="min-h-16 text-sm"
                      />
                      {log.resolvedChecklistItemIds?.length > 0 && (
                        <div className="mt-3">
                          <Label className="text-[10px] font-semibold uppercase text-slate-400 mb-1 block">
                            After Photos
                          </Label>
                          <div className="space-y-2">
                            {log.resolvedChecklistItemIds.map((itemId: string) => {
                              const item = checklist.find((c) => c.id === itemId);
                              const photos = editAfterPhotos[itemId] || [];
                              return item ? (
                                <div key={itemId} className="rounded-lg border border-slate-200 p-2">
                                  <p className="text-[11px] text-slate-600 mb-1">{item.point}</p>
                                  <div className="flex gap-1.5 flex-wrap items-center">
                                    {photos.map((photo: string, pIdx: number) => (
                                      <div key={pIdx} className="relative h-14 w-14 rounded border overflow-hidden group">
                                        <img src={photo} alt="After" className="object-cover w-full h-full" />
                                        <button
                                          type="button"
                                          onClick={(e) => { e.preventDefault(); removeEditAfterPhoto(itemId, pIdx); }}
                                          className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                                        >
                                          <X className="h-3 w-3 text-white" />
                                        </button>
                                      </div>
                                    ))}
                                    {photos.length < 2 && (
                                      <>
                                        <input
                                          type="file"
                                          accept="image/*"
                                          id={`edit-after-${itemId}`}
                                          className="hidden"
                                          onChange={(e) => handleEditPhotoUpload(itemId, e)}
                                        />
                                        <label
                                          htmlFor={`edit-after-${itemId}`}
                                          className="flex items-center justify-center gap-1 h-14 w-14 border-2 border-dashed border-slate-300 rounded-lg text-slate-400 hover:border-primary hover:text-primary cursor-pointer transition-colors"
                                        >
                                          <Plus className="h-3 w-3" />
                                        </label>
                                      </>
                                    )}
                                  </div>
                                </div>
                              ) : null;
                            })}
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2 justify-end mt-2">
                        <Button variant="outline" size="sm" onClick={() => setEditingLogId(null)}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={saveEditNotes} disabled={updateMutation.isPending}>
                          {updateMutation.isPending ? "Saving..." : "Save"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    log.notes && (
                      <p className="text-sm text-slate-600 mt-2">{log.notes}</p>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
