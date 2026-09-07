import { useEffect, useRef, useState } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

const PULL_THRESHOLD = 70;
const PULL_MAX = 120;

// Soft refresh: refetch visible queries. Online → fresh data; offline →
// cache serves and nothing visibly changes (banner already says offline).
// Never a hard reload — that would drop scroll state and risk nothing, but
// cost the whole shell re-parse on slow site networks.
export async function softRefresh(): Promise<void> {
  await queryClient.invalidateQueries().catch(() => {});
}

// Pull-down-to-refresh for the PWA (standalone has no reload button and
// iOS fires no native pull gesture). Attaches to the wrapping scroll
// container — only engages when it's already scrolled to the very top.
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const scroller = el.parentElement; // Layout's <main overflow-y-auto>
    if (!scroller) return;

    const onTouchStart = (e: TouchEvent) => {
      if (scroller.scrollTop <= 0 && !refreshing) {
        startY.current = e.touches[0].clientY;
      } else {
        startY.current = -1;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (startY.current < 0 || refreshing) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0 && scroller.scrollTop <= 0) {
        if (e.cancelable) e.preventDefault();
        setPull(Math.min(dy * 0.5, PULL_MAX));
      } else {
        startY.current = -1;
        setPull(0);
      }
    };
    const onTouchEnd = async () => {
      if (startY.current < 0) return;
      startY.current = -1;
      if (pull >= PULL_THRESHOLD && !refreshing) {
        setRefreshing(true);
        try {
          await softRefresh();
        } finally {
          setRefreshing(false);
        }
      }
      setPull(0);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [refreshing, pull]);

  const showIndicator = refreshing || pull > 0;

  return (
    <div ref={wrapRef} className="relative min-h-full">
      {showIndicator && (
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex justify-center"
          style={{ transform: `translateY(${refreshing ? 12 : pull * 0.6}px)` }}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-md border border-slate-200">
            {refreshing || pull >= PULL_THRESHOLD ? (
              <Loader2
                className={`h-4 w-4 text-primary ${refreshing ? "animate-spin" : ""}`}
              />
            ) : (
              <ArrowDown className="h-4 w-4 text-slate-400" />
            )}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
