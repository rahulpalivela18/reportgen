import { useState } from "react";
import Layout from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Building2, Save, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { isAdminRole, compressImageFile } from "@/lib/utils";

export default function Settings() {
  const { user, workspace, refreshWorkspace } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = isAdminRole(user?.role);

  const [profile, setProfile] = useState({
    name: workspace?.name || "",
    email: workspace?.email || "",
    phone: workspace?.phone || "",
    address: workspace?.address || "",
    logoUrl: workspace?.logoUrl || "",
  });
  const [logoPreview, setLogoPreview] = useState(workspace?.logoUrl || "");

  const saveMutation = useMutation({
    mutationFn: () => api.updateWorkspace(profile),
    onSuccess: (data: any) => {
      refreshWorkspace(data);
      toast({
        title: "Settings Saved",
        description: "Your company profile has been updated.",
      });
    },
    onError: (err: any) =>
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      }),
  });

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { dataUrl } = await compressImageFile(file, 512, 0.85);
      setProfile({ ...profile, logoUrl: dataUrl });
      setLogoPreview(dataUrl);
    } catch {
      // compression failed — user can retry
    }
  };

  return (
    <Layout>
      <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6 md:space-y-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your workspace and company profile.
          </p>
        </div>

        {/* Company Profile */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" /> Company Profile
            </CardTitle>
            <CardDescription>
              This information will be displayed on the cover page and footer of
              all generated PDF reports.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="companyName" className="font-semibold">
                  Company Name
                </Label>
                <Input
                  id="companyName"
                  value={profile.name}
                  onChange={(e) =>
                    setProfile({ ...profile, name: e.target.value })
                  }
                  placeholder="Company Name"
                  disabled={!isAdmin}
                  data-testid="input-company-name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone" className="font-semibold">
                  Phone Number
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  value={profile.phone}
                  onChange={(e) =>
                    setProfile({ ...profile, phone: e.target.value })
                  }
                  placeholder="+91 123 456 7890"
                  disabled={!isAdmin}
                  data-testid="input-company-phone"
                />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="address" className="font-semibold">
                  Business Address
                </Label>
                <Input
                  id="address"
                  value={profile.address}
                  onChange={(e) =>
                    setProfile({ ...profile, address: e.target.value })
                  }
                  placeholder="123 Main St, City, State, ZIP"
                  disabled={!isAdmin}
                  data-testid="input-company-address"
                />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label className="font-semibold">Company Logo</Label>
                <div className="flex flex-col sm:flex-row items-start gap-4">
                  <div className="w-24 h-24 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center bg-slate-50 shrink-0 overflow-hidden">
                    {logoPreview ? (
                      <img
                        src={logoPreview}
                        alt="Logo preview"
                        className="w-full h-full object-contain p-2"
                      />
                    ) : (
                      <ImageIcon className="h-8 w-8 text-slate-300" />
                    )}
                  </div>
                  <div className="flex-1 space-y-2 w-full">
                    <Input
                      id="logo"
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="cursor-pointer max-w-sm"
                      disabled={!isAdmin}
                      data-testid="input-company-logo"
                    />
                    <p className="text-xs text-muted-foreground">
                      Upload a square PNG or JPG. This will appear on your
                      report headers and PDF covers.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            {isAdmin && (
              <div className="flex justify-end pt-4 border-t">
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="gap-2"
                  data-testid="button-save-settings"
                >
                  <Save className="h-4 w-4" />{" "}
                  {saveMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
