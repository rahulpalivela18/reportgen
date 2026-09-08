import { useState } from "react";
import Layout from "@/components/Layout";
import { OfflineDownloadButton } from "@/components/OfflineDownloadButton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { isQueuedResponse, OFFLINE_QUEUED_MARKER } from "@/lib/offline";
import { seedCachedDetail, appendToCachedList } from "@/lib/prefetch";
import {
  buildDimensionsFromChecklist,
  DEFAULT_DIMENSION_UNIT,
  DEFAULT_SPACE_COUNTS,
  getSpaceCount,
  pluralize,
  type ReportSpaceCounts,
} from "@/lib/defaultChecklist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  FileText,
  Calendar,
  ArrowLeft,
  ArrowRight,
  Clock,
  User,
  Settings,
  Trash2,
  Map,
  Share2,
  Copy,
  Check,
} from "lucide-react";
import { Link, useRoute, useLocation } from "wouter";
import { ProjectTabs } from "@/components/ProjectTabs";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { isAdminRole } from "@/lib/utils";
import { buildChecklistWithPreservedResponses } from "@/lib/checklist";
import { pick } from "@shared/cleanData";
import NotFound from "./not-found";



const getStatusColor = (status: string) => {
  switch (status) {
    case "Final":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "Review":
      return "bg-amber-100 text-amber-800 border-amber-200";
    default:
      return "bg-slate-100 text-slate-800 border-slate-200";
  }
};

export default function ProjectDetails() {
  const { user } = useAuth();
  const [match, params] = useRoute("/project/:id/reports");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditProjectOpen, setIsEditProjectOpen] = useState(false);
  const [isEditReportOpen, setIsEditReportOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<any>(null);
  const [reportToDelete, setReportToDelete] = useState<any>(null);
  const [editProjectData, setEditProjectData] = useState<any>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isNewVisitOpen, setIsNewVisitOpen] = useState(false);
  const [newVisitTitle, setNewVisitTitle] = useState("");
  const [openReportAfterVisit, setOpenReportAfterVisit] = useState(false);

  const [newReport, setNewReport] = useState({
    title: "",
    author: "",
    inspectionType: ["Home Inspection"],
    status: "Draft" as const,
    date: format(new Date(), "yyyy-MM-dd"),
    spaceCounts: { ...DEFAULT_SPACE_COUNTS },
    visitId: null as string | null,
  });
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>(
    {},
  );
  const [editCategoryCounts, setEditCategoryCounts] = useState<
    Record<string, number>
  >({});

  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ["project", params?.id],
    queryFn: () => api.getProject(params!.id),
    enabled: !!params?.id,
  });

  const { data: checklistTemplates = [] } = useQuery({
    queryKey: ["checklist-templates"],
    queryFn: () => api.getChecklistTemplates(),
    staleTime: Infinity,
  });

  const { data: reports = [], isLoading: loadingReports } = useQuery({
    queryKey: ["reports", params?.id],
    queryFn: () => api.getReports(params!.id),
    enabled: !!params?.id,
  });

  const { data: shareLinks = [] } = useQuery({
    queryKey: ["share-links", params?.id],
    queryFn: () => api.getShareLinks(params!.id),
    enabled: !!params?.id && isShareOpen,
  });

  const { data: visits = [] } = useQuery({
    queryKey: ["visits", params?.id],
    queryFn: () => api.getVisits(params!.id),
    enabled: !!params?.id,
  });

  const createShareLinkMutation = useMutation({
    mutationFn: () => api.createShareLink(params!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["share-links", params?.id] });
    },
  });

  const deleteShareLinkMutation = useMutation({
    mutationFn: (id: string) => api.deleteShareLink(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["share-links", params?.id] });
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: (data: any) => api.updateProject(params!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", params?.id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setIsEditProjectOpen(false);
    },
    onError: (err: any) =>
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      }),
  });

  const createReportMutation = useMutation({
    mutationFn: (data: any) => api.createReport(params!.id, data),
    onSuccess: (report: any) => {
      if (isQueuedResponse(report)) {
        // Offline: seed caches so the newborn report opens immediately.
        const { [OFFLINE_QUEUED_MARKER]: _, ...rest } = report;
        const shaped = { ...rest, projectId: params!.id, issues: [] };
        queryClient.setQueryData(["report", report.id], shaped);
        queryClient.setQueryData(["reports", params?.id], (old: any[]) => [
          ...(old ?? []),
          shaped,
        ]);
        seedCachedDetail(`/api/reports/${report.id}`, shaped);
        appendToCachedList(`/api/projects/${params!.id}/reports`, shaped);
      } else {
        queryClient.invalidateQueries({ queryKey: ["reports", params?.id] });
      }
      setIsDialogOpen(false);
      setNewReport({
        title: "",
        author: "",
        inspectionType: ["Home Inspection"],
        status: "Draft",
        date: format(new Date(), "yyyy-MM-dd"),
        spaceCounts: { ...DEFAULT_SPACE_COUNTS },
        visitId: null,
      });
      setCategoryCounts({});
      setLocation(`/report/${report.id}`);
    },
    onError: (err: any) =>
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      }),
  });

  const updateReportMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.updateReport(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports", params?.id] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      setIsEditReportOpen(false);
    },
    onError: (err: any) =>
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      }),
  });

  const deleteReportMutation = useMutation({
    mutationFn: (id: string) => api.deleteReport(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports", params?.id] });
      setReportToDelete(null);
      toast({ title: "Report deleted successfully" });
    },
    onError: (err: any) =>
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      }),
  });

  const createVisitMutation = useMutation({
    mutationFn: (title: string) => api.createVisit(params!.id, title),
    onSuccess: (visit: any) => {
      if (isQueuedResponse(visit)) {
        const { [OFFLINE_QUEUED_MARKER]: _, ...rest } = visit;
        const active = { ...rest, active: true };
        queryClient.setQueryData(["visits", params?.id], (old: any[]) => [
          active,
          ...((old ?? []).map((v: any) => ({ ...v, active: false }))),
        ]);
        appendToCachedList(`/api/projects/${params!.id}/visits`, active);
      } else {
        queryClient.invalidateQueries({ queryKey: ["visits", params?.id] });
      }
      setIsNewVisitOpen(false);
      setNewVisitTitle("");
      setNewReport((r) => ({ ...r, visitId: visit.id }));
      if (openReportAfterVisit) {
        setOpenReportAfterVisit(false);
        setIsDialogOpen(true);
      }
    },
    onError: (err: any) =>
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      }),
  });

  const updateSpaceCount = (key: keyof ReportSpaceCounts, value: string) => {
    const nextValue = Math.max(0, Number(value) || 0);
    setNewReport({
      ...newReport,
      spaceCounts: { ...newReport.spaceCounts, [key]: nextValue },
    });
  };

  const handleUpdateProject = () => {
    if (!editProjectData?.title) return;
    updateProjectMutation.mutate(editProjectData);
  };

  const openEditReport = async (report: any, e: React.MouseEvent) => {
    e.stopPropagation();
    // Fetch full report data (checklist, dimensions, issues are stripped from list API)
    const fullReport = await api.getReport(report.id);
    setEditingReport({
      ...fullReport,
      inspectionType: Array.isArray(fullReport.inspectionType)
        ? fullReport.inspectionType
        : [fullReport.inspectionType || "Home Inspection"],
    });
    const reportType = Array.isArray(fullReport.inspectionType)
      ? fullReport.inspectionType[0]
      : fullReport.inspectionType || "Home Inspection";
    const typeTemplates = checklistTemplates.filter(
      (t: any) => t.checklistType === reportType,
    );
    const typeCategories = Array.from(
      new Set(typeTemplates.map((t: any) => t.category)),
    );

    const counts: Record<string, number> = {};
    typeCategories.forEach((cat: any) => {
      counts[cat] = getSpaceCount(fullReport.spaceCounts ?? {}, cat);
    });

    setEditCategoryCounts(counts);
    setIsEditReportOpen(true);
  };

  const handleUpdateReport = () => {
    if (!editingReport?.title) return;
    const selectedType = editingReport.inspectionType?.[0] || "Home Inspection";
    const typeTemplates = checklistTemplates.filter(
      (t: any) => t.checklistType === selectedType,
    );
    const typeCategories = Array.from(
      new Set(typeTemplates.map((t: any) => t.category)),
    );

    const nextChecklist = buildChecklistWithPreservedResponses(
      typeTemplates,
      editingReport.checklist,
      editCategoryCounts,
    );
    const nextDimensionUnit =
      editingReport.dimensionUnit ?? DEFAULT_DIMENSION_UNIT;
    const nextDimensions = buildDimensionsFromChecklist(
      nextChecklist,
      editingReport.dimensions ?? [],
      nextDimensionUnit,
    );

    const spaceCountsToSave = { ...editCategoryCounts };

    updateReportMutation.mutate({
      id: editingReport.id,
      data: {
        ...pick(editingReport, ["title", "author", "status", "date"]),
        inspectionType: Array.isArray(editingReport.inspectionType)
          ? editingReport.inspectionType
          : [editingReport.inspectionType || "Home Inspection"],
        spaceCounts: spaceCountsToSave,
        dimensionUnit: nextDimensionUnit,
        dimensions: nextDimensions,
        checklist: nextChecklist,
      },
    });
  };

  const handleCreateReport = () => {
    if (!newReport.title || !newReport.author) return;
    const selectedTemplates = checklistTemplates.filter((t: any) =>
      newReport.inspectionType.includes(t.checklistType),
    );

    const checklist = buildChecklistWithPreservedResponses(
      selectedTemplates,
      [],
      categoryCounts,
    );

    const spaceCountsToSave = { ...categoryCounts } as Record<string, number>;

    const reportData = {
      title: newReport.title,
      author: newReport.author,
      date: newReport.date,
      status: newReport.status,
      inspectionType: newReport.inspectionType,
      checklist,
      dimensionUnit: DEFAULT_DIMENSION_UNIT,
      dimensions: buildDimensionsFromChecklist(
        checklist,
        [],
        DEFAULT_DIMENSION_UNIT,
      ),
      spaceCounts: spaceCountsToSave,
      visitId: newReport.visitId,
    };
    createReportMutation.mutate(reportData);
  };

  if (!match || !params) return <NotFound />;
  if (loadingProject)
    return (
      <Layout>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          Loading...
        </div>
      </Layout>
    );
  if (!project) return <NotFound />;

  const templatesToUse = checklistTemplates.filter((t: any) =>
    newReport.inspectionType.includes(t.checklistType),
  );
  const templateCategories = Array.from(
    new Set(templatesToUse.map((t: any) => t.category)),
  );
  const checklistPreviewCount =
    templatesToUse.length > 0
      ? buildChecklistWithPreservedResponses(templatesToUse, [], categoryCounts)
          .length
      : 0;

  const filteredReports = newReport.visitId
    ? reports.filter((r: any) => r.visitId === newReport.visitId)
    : reports;

  return (
    <Layout>
      <div className="flex flex-col min-h-full">
        {/* Project Header */}
        <div className="bg-white border-b border-border py-6 md:py-8 px-4 md:px-8">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <Link
                href="/dashboard"
                className="inline-flex items-center text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                <ArrowLeft className="mr-1 h-4 w-4" /> All Projects
              </Link>
              <ProjectTabs
                projectId={params.id}
                active="reports"
                admin={isAdminRole(user?.role)}
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
              <div className="flex-1">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
                  {project.title}
                </h1>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 text-muted-foreground text-sm">
                  <span className="flex items-center gap-1 shrink-0">
                    <User className="h-4 w-4" /> {project.clientName}
                  </span>
                  <span className="hidden sm:block w-1 h-1 rounded-full bg-slate-300"></span>
                  <span className="shrink-0">{project.address}</span>
                </div>
                {user?.role !== "viewer" && (
                <div className="flex items-center gap-2 mt-4">
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 h-auto text-primary font-semibold hover:no-underline flex items-center gap-1"
                    onClick={() => {
                      setEditProjectData({
                        title: project.title,
                        clientName: project.clientName,
                        address: project.address,
                        description: project.description,
                      });
                      setIsEditProjectOpen(true);
                    }}
                  >
                    <Settings className="w-3.5 h-3.5" /> Edit Project Details
                  </Button>
                  <span className="text-slate-300">|</span>
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 h-auto text-slate-500 hover:text-primary font-semibold hover:no-underline flex items-center gap-1"
                    onClick={() => setIsShareOpen(true)}
                  >
                    <Share2 className="w-3.5 h-3.5" /> Share
                  </Button>
                </div>
                )}
              </div>
              <div className="flex flex-col gap-3 shrink-0">
                <OfflineDownloadButton projectId={params.id} />
                {user?.role !== "viewer" && (
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <Button
                    size="lg"
                    className="w-full sm:w-auto shadow-lg shadow-primary/20"
                    data-testid="button-create-report"
                    onClick={() => {
                      if (visits.length === 0) {
                        setNewVisitTitle(
                          new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                        );
                        setOpenReportAfterVisit(true);
                        setIsNewVisitOpen(true);
                      } else {
                        setIsDialogOpen(true);
                      }
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" /> New Report
                  </Button>
                  <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-[640px]">
                    <div className="flex max-h-[92vh] flex-col">
                      <DialogHeader className="border-b border-slate-100 px-4 py-4 text-left sm:px-6 sm:py-5">
                        <DialogTitle>Create New Report</DialogTitle>
                        <DialogDescription>
                          Start a new inspection report for this project.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                        <div className="grid gap-4">
                          <div className="grid gap-2">
                            <Label htmlFor="title">Report Title</Label>
                            <Input
                              id="title"
                              placeholder="e.g. Initial Site Survey"
                              value={newReport.title}
                              onChange={(e) =>
                                setNewReport({
                                  ...newReport,
                                  title: e.target.value,
                                })
                              }
                              data-testid="input-report-title"
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="grid gap-2">
                              <Label htmlFor="author">Author</Label>
                              <Input
                                id="author"
                                placeholder="Your Name"
                                value={newReport.author}
                                onChange={(e) =>
                                  setNewReport({
                                    ...newReport,
                                    author: e.target.value,
                                  })
                                }
                                data-testid="input-report-author"
                              />
                            </div>
                            <div className="grid gap-2">
                              <Label htmlFor="inspection-type">
                                Type of inspection
                              </Label>
                              <Select
                                value={newReport.inspectionType[0] || ""}
                                onValueChange={(val) =>
                                  setNewReport({
                                    ...newReport,
                                    inspectionType: [val],
                                  })
                                }
                              >
                                <SelectTrigger data-testid="select-inspection-type">
                                  <SelectValue placeholder="Select inspection type" />
                                </SelectTrigger>
                                <SelectContent>
                                  {Array.from(
                                    new Set(
                                      checklistTemplates.map(
                                        (t: any) => t.checklistType,
                                      ),
                                    ),
                                  ).map((type: any) => (
                                    <SelectItem key={type} value={type}>
                                      {type}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="date">Date</Label>
                            <Input
                              id="date"
                              type="date"
                              value={newReport.date}
                              onChange={(e) =>
                                setNewReport({
                                  ...newReport,
                                  date: e.target.value,
                                })
                              }
                              data-testid="input-report-date"
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="status">Status</Label>
                            <Select
                              value={newReport.status}
                              onValueChange={(val: any) =>
                                setNewReport({ ...newReport, status: val })
                              }
                            >
                              <SelectTrigger data-testid="select-report-status">
                                <SelectValue placeholder="Select status" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Draft">Draft</SelectItem>
                                <SelectItem value="Review">Review</SelectItem>
                                <SelectItem value="Final">Final</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <p className="text-sm font-semibold text-slate-900">
                                Space Counts
                              </p>
                              <div
                                className="rounded-full bg-slate-100 px-3 py-1 text-center text-xs font-semibold text-slate-600"
                                data-testid="text-generated-points"
                              >
                                {checklistPreviewCount} points total
                              </div>
                            </div>
                            {templateCategories.length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                No spaces for this inspection type.
                              </p>
                            ) : (
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                {templateCategories.map((cat: any) => (
                                  <div key={cat} className="grid gap-2">
                                    <Label htmlFor={cat}>{cat}</Label>
                                    <Input
                                      id={cat}
                                      type="number"
                                      min="0"
                                      value={categoryCounts[cat] ?? 1}
                                      onChange={(e) =>
                                        setCategoryCounts((prev) => ({
                                          ...prev,
                                          [cat]: parseInt(e.target.value) || 0,
                                        }))
                                      }
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <DialogFooter className="border-t border-slate-100 bg-white px-4 py-4 sm:px-6">
                        <Button
                          variant="outline"
                          className="w-full sm:w-auto"
                          onClick={() => setIsDialogOpen(false)}
                          data-testid="button-cancel-report-create"
                        >
                          Cancel
                        </Button>
                        <Button
                          className="w-full sm:w-auto"
                          onClick={handleCreateReport}
                          disabled={createReportMutation.isPending}
                          data-testid="button-confirm-report-create"
                        >
                          {createReportMutation.isPending
                            ? "Creating..."
                            : "Create Report"}
                        </Button>
                      </DialogFooter>
                    </div>
                  </DialogContent>
                </Dialog>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Reports List */}
        <div className="flex-1 bg-muted/10 p-4 md:p-8">
          <div className="max-w-7xl mx-auto">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold md:text-xl">
                Reports ({filteredReports.length})
              </h2>
              {visits.length > 0 && (
                <select
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  value={newReport.visitId || "all"}
                  onChange={(e) => {
                    const val = e.target.value === "all" ? null : e.target.value;
                    setNewReport({ ...newReport, visitId: val });
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
            </div>
            {loadingReports ? (
              <div className="text-center py-12 text-muted-foreground">
                Loading reports...
              </div>
            ) : reports.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 md:py-16 text-center border-2 border-dashed border-border rounded-xl bg-white px-4">
                <div className="bg-muted p-4 rounded-full mb-4">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium">No reports yet</h3>
                <p className="text-muted-foreground max-w-xs mt-2 mb-6">
                  Create your first report to get started.
                </p>
                {user?.role !== "viewer" && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (visits.length === 0) {
                      setNewVisitTitle(
                        new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      );
                      setOpenReportAfterVisit(true);
                      setIsNewVisitOpen(true);
                    } else {
                      setIsDialogOpen(true);
                    }
                  }}
                  data-testid="button-create-first-report"
                >
                  Create Report
                </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:gap-4">
                {filteredReports.map((report: any) => (
                  <Card
                    key={report.id}
                    className="hover:shadow-md transition-shadow cursor-pointer group"
                    onClick={() => setLocation(`/report/${report.id}`)}
                  >
                    <div className="flex flex-col md:flex-row md:items-center p-4 md:p-6 gap-3 md:gap-4">
                      <div className="flex-shrink-0 bg-primary/10 p-2 md:p-3 rounded-lg text-primary w-fit">
                        <FileText className="h-5 w-5 md:h-6 md:w-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-1">
                          <h3 className="text-base md:text-lg font-semibold truncate group-hover:text-primary transition-colors">
                            {report.title}
                          </h3>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`${getStatusColor(report.status)} border-0 font-medium text-[10px] md:text-xs`}
                            >
                              {report.status}
                            </Badge>
                            {report.inspectionType?.[0] && (
                              <span className="text-[10px] md:text-xs text-muted-foreground">
                                {report.inspectionType[0]}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] md:text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" /> {report.author}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" /> {report.date}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {format(new Date(report.createdAt), "MMM d")}
                          </span>
                          {report.visitId && visits.length > 0 && (
                            <span className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
                              {visits.find((v: any) => v.id === report.visitId)?.title || "Visit"}
                            </span>
                          )}
                        </div>
                        {report.spaceCounts && (
                            <div
                              className="mt-3 flex flex-wrap gap-2"
                              data-testid={`text-space-summary-${report.id}`}
                            >
                              {Object.entries(report.spaceCounts as Record<string, number>)
                                .filter(([, count]) => count > 0)
                                .map(([category, count]) => (
                                  <span
                                    key={category}
                                    className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600"
                                  >
                                    {count} {pluralize(category, count)}
                                  </span>
                                ))}
                            </div>
                          )}
                      </div>
                      <div className="shrink-0 flex flex-col md:flex-row items-center md:border-l md:pl-4 mt-2 md:mt-0 pt-2 md:pt-0 border-t md:border-t-0 gap-2">
                        {user?.role !== "viewer" && visits.length > 0 && (
                          <select
                            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                            value={report.visitId || ""}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation();
                              updateReportMutation.mutate({
                                id: report.id,
                                data: { visitId: e.target.value || null },
                              });
                            }}
                          >
                            <option value="">No visit</option>
                            {visits.map((v: any) => (
                              <option key={v.id} value={v.id}>
                                {v.title}
                              </option>
                            ))}
                          </select>
                        )}
                        {user?.role !== "viewer" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full md:w-auto"
                          onClick={(e: any) => openEditReport(report, e)}
                        >
                          Edit
                        </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="group-hover:translate-x-1 transition-transform w-full md:w-auto justify-between md:justify-start"
                          onClick={(e: any) => {
                            e.stopPropagation();
                            setLocation(`/report/${report.id}`);
                          }}
                        >
                          Open <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                        {user?.role !== "viewer" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full md:w-auto text-destructive hover:text-destructive"
                          onClick={(e: any) => {
                            e.stopPropagation();
                            setReportToDelete(report);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Edit Project Dialog */}
        <Dialog open={isEditProjectOpen} onOpenChange={setIsEditProjectOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Edit Project Details</DialogTitle>
              <DialogDescription>
                Update the project and client information.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Project Title</Label>
                <Input
                  value={editProjectData?.title || ""}
                  onChange={(e) =>
                    setEditProjectData({
                      ...editProjectData,
                      title: e.target.value,
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Client Name</Label>
                <Input
                  value={editProjectData?.clientName || ""}
                  onChange={(e) =>
                    setEditProjectData({
                      ...editProjectData,
                      clientName: e.target.value,
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Address</Label>
                <Input
                  value={editProjectData?.address || ""}
                  onChange={(e) =>
                    setEditProjectData({
                      ...editProjectData,
                      address: e.target.value,
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Description</Label>
                <Textarea
                  value={editProjectData?.description || ""}
                  onChange={(e) =>
                    setEditProjectData({
                      ...editProjectData,
                      description: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsEditProjectOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpdateProject}
                disabled={updateProjectMutation.isPending}
              >
                {updateProjectMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Report Dialog */}
        {editingReport && (
          <Dialog open={isEditReportOpen} onOpenChange={setIsEditReportOpen}>
            <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-[500px]">
              <div className="flex max-h-[92vh] flex-col">
                <DialogHeader className="px-4 py-4 sm:px-6 sm:py-5">
                  <DialogTitle>Edit Report</DialogTitle>
                  <DialogDescription>
                    Update the report details and space counts.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                  <div className="grid gap-2">
                    <Label>Report Title</Label>
                    <Input
                      value={editingReport.title}
                      onChange={(e) =>
                        setEditingReport({
                          ...editingReport,
                          title: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Author</Label>
                    <Input
                      value={editingReport.author}
                      onChange={(e) =>
                        setEditingReport({
                          ...editingReport,
                          author: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Inspection Type</Label>
                    <Select
                      value={editingReport.inspectionType?.[0] || ""}
                      onValueChange={(val) => {
                        const newTypeTemplates = checklistTemplates.filter(
                          (t: any) => t.checklistType === val,
                        );
                        const newCategories = Array.from(
                          new Set(newTypeTemplates.map((t: any) => t.category)),
                        );
                        const newCounts: Record<string, number> = {};
                        newCategories.forEach((cat: any) => {
                          newCounts[cat] = 0;
                        });
                        setEditCategoryCounts(newCounts);
                        setEditingReport({
                          ...editingReport,
                          inspectionType: [val],
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select inspection type" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from(
                          new Set(
                            checklistTemplates.map((t: any) => t.checklistType),
                          ),
                        ).map((type: any) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Status</Label>
                    <Select
                      value={editingReport.status}
                      onValueChange={(val) =>
                        setEditingReport({ ...editingReport, status: val })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Draft">Draft</SelectItem>
                        <SelectItem value="Review">Review</SelectItem>
                        <SelectItem value="Final">Final</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={editingReport.date}
                      onChange={(e) =>
                        setEditingReport({
                          ...editingReport,
                          date: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="rounded-xl border p-4">
                    {(editingReport.inspectionType?.[0]
                      ? checklistTemplates.filter(
                          (t: any) =>
                            t.checklistType === editingReport.inspectionType[0],
                        )
                      : []
                    ).length > 0 && (
                      <>
                        <p className="text-sm font-semibold mb-3">
                          Space Counts
                        </p>
                        <div className="grid grid-cols-3 gap-3">
                          {Array.from(
                            new Set(
                              (
                                checklistTemplates.filter(
                                  (t: any) =>
                                    t.checklistType ===
                                    editingReport.inspectionType?.[0],
                                ) || []
                              ).map((t: any) => t.category),
                            ),
                          ).map((cat: any) => (
                            <div key={cat} className="grid gap-1">
                              <Label className="text-xs">{cat}</Label>
                              <Input
                                type="number"
                                min="0"
                                value={editCategoryCounts[cat] ?? 0}
                                onChange={(e) =>
                                  setEditCategoryCounts((prev) => ({
                                    ...prev,
                                    [cat]: Math.max(
                                      0,
                                      Number(e.target.value) || 0,
                                    ),
                                  }))
                                }
                              />
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <DialogFooter className="border-t px-4 py-4 sm:px-6">
                  <Button
                    variant="outline"
                    onClick={() => setIsEditReportOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleUpdateReport}
                    disabled={updateReportMutation.isPending}
                  >
                    {updateReportMutation.isPending
                      ? "Saving..."
                      : "Save Changes"}
                  </Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Delete Report Dialog */}
        <Dialog
          open={!!reportToDelete}
          onOpenChange={() => setReportToDelete(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Report</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{reportToDelete?.title}"? This
                action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReportToDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteReportMutation.mutate(reportToDelete?.id)}
                disabled={deleteReportMutation.isPending}
              >
                {deleteReportMutation.isPending ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Share Dialog */}
        <Dialog open={isShareOpen} onOpenChange={setIsShareOpen}>
          <DialogContent className="max-w-lg overflow-hidden box-border w-[calc(100vw-2rem)] sm:w-full">
            <DialogHeader>
              <DialogTitle>Share Project</DialogTitle>
              <DialogDescription>
                Create shareable links for clients to view this project. Links expire after 6 months.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2 overflow-hidden">
              {shareLinks.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">No share links yet. Generate one below.</p>
              )}
              {shareLinks.map((link: any) => {
                const url = `${window.location.origin}/shared/${link.token}`;
                const isExpired = new Date(link.expiresAt) < new Date();
                return (
                  <div key={link.id} className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border border-slate-100 w-full box-border">
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <p className="text-xs font-mono text-slate-700 truncate block w-full">{url}</p>
                      <p className="text-[11px] text-slate-400 mt-1 truncate">
                        {isExpired ? (
                          <span className="text-red-500">Expired</span>
                        ) : (
                          `Expires ${new Date(link.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 shrink-0"
                        title="Copy link"
                        onClick={() => {
                          navigator.clipboard.writeText(url);
                          setCopiedLink(true);
                          setTimeout(() => setCopiedLink(false), 2000);
                        }}
                      >
                        {copiedLink ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 shrink-0 text-red-400 hover:text-red-600"
                        title="Revoke link"
                        onClick={() => deleteShareLinkMutation.mutate(link.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t pt-4">
              <Button
                className="w-full shrink-0"
                onClick={() => createShareLinkMutation.mutate()}
                disabled={createShareLinkMutation.isPending}
              >
                <Share2 className="mr-2 h-4 w-4" />
                {createShareLinkMutation.isPending ? "Creating..." : "Generate New Link"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Create Visit Dialog (prompted when no visits exist) */}
      <Dialog
        open={isNewVisitOpen}
        onOpenChange={(open) => {
          setIsNewVisitOpen(open);
          if (!open) setOpenReportAfterVisit(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a Visit First</DialogTitle>
            <DialogDescription>
              Every report needs to be linked to a visit (inspection round). Give this visit a name to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
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
                setOpenReportAfterVisit(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createVisitMutation.mutate(newVisitTitle.trim())}
              disabled={!newVisitTitle.trim() || createVisitMutation.isPending}
            >
              {createVisitMutation.isPending ? "Creating..." : "Create Visit & Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </Layout>
  );
}
