import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  FolderOpen,
  Settings,
  Menu,
  Building2,
  ClipboardList,
  Shield,
  CreditCard,
  Clock,
  AlertTriangle,
  FileText,
  LogOut,
  User,
  Users,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn, getInitials, isAdminRole } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import Footer from "@/components/Footer";
import { InstallAppButton } from "@/components/InstallAppButton";
import {
  PullToRefresh,
  softRefresh,
} from "@/components/PullToRefresh";

function RefreshButton() {
  const [spinning, setSpinning] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      title="Refresh"
      data-testid="button-refresh"
      onClick={async () => {
        setSpinning(true);
        try {
          await softRefresh();
        } finally {
          setSpinning(false);
        }
      }}
    >
      <RefreshCw className={`h-5 w-5 ${spinning ? "animate-spin" : ""}`} />
    </Button>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { user, workspace, trial, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const navigation = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Projects", href: "/dashboard", icon: FolderOpen },
    { name: "Quotations", href: "/quotations", icon: FileText },
    { name: "Templates", href: "/templates", icon: ClipboardList },
    ...(isAdminRole(user?.role)
      ? [{ name: "Team", href: "/team", icon: Users }]
      : []),
    ...(user?.role !== "viewer"
      ? [{ name: "Settings", href: "/settings", icon: Settings }]
      : []),
    ...(user?.role !== "viewer"
      ? [{ name: "Subscription", href: "/billing", icon: CreditCard }]
      : []),
    ...(user?.role === "super_admin"
      ? [{ name: "Admin", href: "/admin", icon: Shield }]
      : []),
  ];

  const AccountMenu = ({ compact = false }: { compact?: boolean }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-muted"
            data-testid="button-account-menu-mobile"
          >
            <Avatar className="h-7 w-7">
              <AvatarImage
                src={user?.avatarUrl || undefined}
                alt={user?.name || "Account"}
              />
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {getInitials(user?.name, user?.email)}
              </AvatarFallback>
            </Avatar>
          </button>
        ) : (
          <button
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-sidebar-accent/50"
            data-testid="button-account-menu"
          >
            <Avatar className="h-8 w-8">
              <AvatarImage
                src={user?.avatarUrl || undefined}
                alt={user?.name || "Account"}
              />
              <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                {getInitials(user?.name, user?.email)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-900">
                {user?.name || "Account"}
              </span>
              <span className="block truncate text-xs text-slate-500">
                {user?.email}
              </span>
            </span>
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? "end" : "start"} className="w-64">
        <DropdownMenuLabel>
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarImage
                src={user?.avatarUrl || undefined}
                alt={user?.name || ""}
              />
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {getInitials(user?.name, user?.email)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user?.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {user?.email}
              </p>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => navigate("/profile")}
          data-testid="menu-profile"
        >
          <User className="h-4 w-4 mr-2" /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleLogout} data-testid="menu-sign-out">
          <LogOut className="h-4 w-4 mr-2" /> Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const SidebarContent = () => (
    <div className="flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-6">
          <Link
            href="/home"
            className="flex items-center gap-2 font-heading text-2xl font-bold text-primary hover:text-primary/80 transition-colors"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              IO
            </div>
            Inspection OS
          </Link>
          <div className="flex items-center gap-2.5 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/40 px-2.5 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium uppercase leading-tight tracking-wide text-muted-foreground">
                Workspace
              </p>
              <h3 className="truncate text-sm font-semibold leading-tight text-foreground">
                {workspace?.name || "Loading..."}
              </h3>
            </div>
          </div>

          {trial?.isTrial && (
            <div
              className={cn(
                "rounded-2xl border p-3 shadow-sm",
                trial.isExpired
                  ? "border-red-200 bg-red-50"
                  : trial.daysRemaining !== null && trial.daysRemaining <= 3
                    ? "border-amber-200 bg-amber-50"
                    : "border-indigo-200 bg-indigo-50",
              )}
            >
              <div className="flex items-center gap-2">
                {trial.isExpired ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                ) : (
                  <Clock className="h-4 w-4 shrink-0 text-indigo-600" />
                )}
                <div className="min-w-0">
                  {trial.isExpired ? (
                    <p className="text-xs font-semibold text-red-800">
                      Trial expired
                    </p>
                  ) : (
                    <p className="text-xs font-semibold text-indigo-800">
                      Free trial — {trial.daysRemaining} day
                      {trial.daysRemaining === 1 ? "" : "s"} left
                    </p>
                  )}
                  {trial.limits && trial.usage && !trial.isExpired && (
                    <div className="mt-1.5 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">Projects</span>
                        <span
                          className={cn(
                            "font-medium",
                            trial.usage.projects >= trial.limits.maxProjects
                              ? "text-amber-600"
                              : "text-slate-700",
                          )}
                        >
                          {trial.usage.projects}/{trial.limits.maxProjects}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">Captures</span>
                        <span
                          className={cn(
                            "font-medium",
                            trial.usage.captures >= trial.limits.maxCaptures
                              ? "text-amber-600"
                              : "text-slate-700",
                          )}
                        >
                          {trial.usage.captures}/{trial.limits.maxCaptures}
                        </span>
                      </div>
                    </div>
                  )}
                  {trial.isExpired && (
                    <Link href="/contact">
                      <span className="mt-1 inline-block text-[11px] font-medium text-red-700 underline cursor-pointer hover:text-red-900">
                        Contact us to upgrade
                      </span>
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1 px-4 py-4">
          {navigation.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.name} href={item.href}>
                <div
                  onClick={() => setIsMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-200 cursor-pointer",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                  )}
                >
                  <item.icon
                    className={cn("h-4 w-4", isActive ? "text-primary" : "")}
                  />
                  {item.name}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <InstallAppButton />
          <AccountMenu />
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-background">
      <div className="hidden h-full w-72 shrink-0 md:block">
        <SidebarContent />
      </div>

      <div className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between border-b border-sidebar-border bg-background px-4 md:hidden">
        <Link
          href="/home"
          className="flex items-center gap-2 font-heading text-lg font-bold text-primary hover:text-primary/80 transition-colors"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded bg-primary text-[10px] text-primary-foreground">
            IO
          </div>
          Inspection OS
        </Link>
        <div className="flex items-center gap-2">
          <AccountMenu compact />
          <InstallAppButton />
          <RefreshButton />
          <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                data-testid="button-open-mobile-menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[300px] border-r-0 p-0">
              <SidebarContent />
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <main className="h-full w-full flex-1 overflow-y-auto pt-14 md:pt-0">
        <PullToRefresh>
          <div className="min-h-full">{children}</div>
          <Footer />
        </PullToRefresh>
      </main>
    </div>
  );
}
