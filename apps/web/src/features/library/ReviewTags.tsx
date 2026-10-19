import React, { useLayoutEffect, useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";

const tagClass =
  "shrink-0 whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-neutral-600";
const counterClass =
  "shrink-0 whitespace-nowrap rounded bg-white px-1.5 py-0.5 font-medium tabular-nums text-blue-700";

export function ReviewTags({ tags }: { tags: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tags.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measurement = measurementRef.current;
    if (!container || !measurement) return;
    const update = () => {
      const widths = Array.from(
        measurement.querySelectorAll<HTMLElement>("[data-tag]"),
      ).map((tag) => tag.getBoundingClientRect().width);
      const counterWidth = measurement
        .querySelector<HTMLElement>("[data-counter]")!
        .getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(measurement).columnGap) || 0;
      const available = container.clientWidth;
      if (
        widths.reduce((sum, width) => sum + width, 0) +
          gap * Math.max(0, widths.length - 1) <=
        available
      ) {
        setVisibleCount(tags.length);
        return;
      }
      let used = 0,
        count = 0;
      for (const width of widths) {
        const next = used + (count ? gap : 0) + width;
        if (next + gap + counterWidth > available) break;
        used = next;
        count++;
      }
      setVisibleCount(count);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(measurement);
    return () => observer.disconnect();
  }, [tags]);

  const hiddenTags = tags.slice(visibleCount);
  return (
    <div ref={containerRef} className="relative min-w-0 overflow-hidden">
      <div className="flex items-center gap-1" aria-label="文章标签">
        {tags.slice(0, visibleCount).map((tag) => (
          <span key={tag} className={tagClass}>
            {tag}
          </span>
        ))}
        {hiddenTags.length > 0 && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger
                className={counterClass}
                aria-label={`还有 ${hiddenTags.length} 个标签`}
              >
                +{hiddenTags.length}
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex flex-wrap gap-1.5">
                  {hiddenTags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-white/10 px-1.5 py-0.5"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div
        ref={measurementRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 flex w-max items-center gap-1"
      >
        {tags.map((tag, index) => (
          <span key={index} data-tag className={tagClass}>
            {tag}
          </span>
        ))}
        <span data-counter className={counterClass}>
          +{tags.length}
        </span>
      </div>
    </div>
  );
}
