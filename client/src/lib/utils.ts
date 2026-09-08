import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isAdminRole(role?: string) {
  return role === "admin" || role === "super_admin";
}

// Initials for avatars — falls back from name → email → "?".
export function getInitials(name?: string, email?: string) {
  const source = (name?.trim() || email?.trim() || "?").charAt(0);
  return source.toUpperCase();
}

// Compress a user-picked image before upload/storage.
// Resizes so the long edge is at most `maxEdge` px, re-encodes as JPEG.
// A 4000px phone photo (~4-8MB base64) becomes ~300-500KB — critical for
// GCP costs, sync time, and offline OPFS storage. Small images pass through
// at native size (still re-encoded to JPEG for a uniform pipeline).
export function compressImageFile(
  file: File,
  maxEdge = 1920,
  quality = 0.8,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(
          1,
          maxEdge / Math.max(img.naturalWidth, img.naturalHeight),
        );
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve({
          dataUrl: c.toDataURL("image/jpeg", quality),
          width: w,
          height: h,
        });
      };
      img.onerror = () => reject(new Error("Failed to decode image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

export function ensureJpeg(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      resolve(c.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () =>
      reject(new Error("Failed to load image for PDF export"));
    img.src =
      src.startsWith("http") && !src.startsWith(location.origin)
        ? `/api/image-proxy?url=${encodeURIComponent(src)}`
        : src;
  });
}
