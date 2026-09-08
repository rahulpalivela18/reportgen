import { useState } from "react";
import Layout from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { User as UserIcon, Save, KeyRound, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ROLE_LABELS } from "@/lib/constants";
import { getInitials, compressImageFile } from "@/lib/utils";

export default function Profile() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();

  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [avatarPreview, setAvatarPreview] = useState<string>(
    user?.avatarUrl ?? "",
  );

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { dataUrl } = await compressImageFile(file, 512, 0.85);
      setAvatarPreview(dataUrl);
    } catch {
      // compression failed — user can retry
    }
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateUser({
        name: name.trim() || undefined,
        phone: phone.trim() || null,
        avatarUrl: avatarPreview || null,
      }),
    onSuccess: (data: any) => {
      refreshUser({
        name: data.name,
        phone: data.phone,
        avatarUrl: data.avatarUrl,
      });
      toast({
        title: "Profile Updated",
        description: "Your profile has been saved.",
      });
    },
    onError: (err: any) =>
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      }),
  });

  const passwordMutation = useMutation({
    mutationFn: () =>
      api.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      toast({ title: "Password Changed", description: "Your password was updated." });
    },
    onError: (err: any) =>
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      }),
  });

  const roleBadge = ROLE_LABELS[user?.role ?? ""];

  return (
    <Layout>
      <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6 md:space-y-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            My Profile
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your personal details and password.
          </p>
        </div>

        {/* Personal Profile */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserIcon className="h-5 w-5 text-primary" /> Personal Profile
            </CardTitle>
            <CardDescription>
              Your name, avatar, and phone. Your role is managed by an admin on
              the Team page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start gap-4">
              <Avatar className="h-20 w-20">
                <AvatarImage
                  src={avatarPreview || undefined}
                  alt={name || "User avatar"}
                />
                <AvatarFallback className="text-2xl font-semibold text-slate-600">
                  {getInitials(name, user?.email)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-2 w-full">
                <Input
                  id="avatar"
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="cursor-pointer max-w-sm"
                  data-testid="input-avatar"
                />
                <p className="text-xs text-muted-foreground">
                  Upload a square PNG or JPG. This appears next to your name.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="name" className="font-semibold">
                  Name
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  data-testid="input-profile-name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone" className="font-semibold">
                  Phone
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 123 456 7890"
                  data-testid="input-profile-phone"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email" className="font-semibold">
                  Email
                </Label>
                <Input
                  id="email"
                  value={user?.email ?? ""}
                  disabled
                  className="text-slate-400 cursor-not-allowed"
                  data-testid="input-profile-email"
                />
                <p className="text-xs text-muted-foreground">
                  Email is your login identifier and can't be changed here.
                </p>
              </div>
              <div className="grid gap-2">
                <Label className="font-semibold">Role</Label>
                <div className="flex h-9 items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-medium ${roleBadge?.color || ""}`}
                    data-testid="badge-profile-role"
                  >
                    {roleBadge?.label || user?.role || "—"}
                  </Badge>
                  <p className="text-xs text-muted-foreground">
                    Read-only — assigned by your admin.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="gap-2"
                data-testid="button-save-profile"
              >
                <Save className="h-4 w-4" />
                {saveMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Change Password */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" /> Change Password
            </CardTitle>
            <CardDescription>
              Use your current password to set a new one (min 6 characters).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="currentPassword" className="font-semibold">
                  Current Password
                </Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  autoComplete="current-password"
                  data-testid="input-current-password"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="newPassword" className="font-semibold">
                  New Password
                </Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  autoComplete="new-password"
                  data-testid="input-new-password"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => passwordMutation.mutate()}
                disabled={
                  passwordMutation.isPending ||
                  !currentPassword ||
                  newPassword.length < 6
                }
                className="gap-2"
                data-testid="button-change-password"
              >
                <KeyRound className="h-4 w-4" />
                {passwordMutation.isPending ? "Changing..." : "Change Password"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
