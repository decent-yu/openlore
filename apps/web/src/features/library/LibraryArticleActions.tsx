import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  BookOpen,
  Loader2,
  MoreHorizontal,
  RotateCw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { LibraryArticle } from "@openlore/contracts";
import { Button } from "../../components/ui/button.js";

interface Action {
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  busy?: boolean;
  onSelect: () => void;
  href?: string;
}

export function LibraryArticleActions({
  article,
  reviewPending,
  onReview,
  onResearch,
  onViewReport,
}: {
  article: LibraryArticle;
  reviewPending: boolean;
  onReview: () => void;
  onResearch: () => void;
  onViewReport: () => void;
}) {
  const reviewed = article.review?.status === "succeeded";
  const reviewBusy =
    article.review?.status === "queued" || article.review?.status === "running";
  const researchBusy =
    article.research?.status === "queued" ||
    article.research?.status === "running";
  const researched = article.research?.status === "succeeded";
  const review: Action = {
    label:
      article.review?.status === "queued"
        ? "初审排队中"
        : article.review?.status === "running"
          ? "初审中"
          : reviewed
            ? "重新审核"
            : article.review?.status === "insufficient"
              ? "重新检查正文"
              : article.review?.status === "failed"
                ? "重试初审"
                : "发起初审",
    icon: reviewBusy ? Loader2 : RotateCw,
    disabled: reviewPending || reviewBusy,
    busy: reviewBusy,
    onSelect: onReview,
  };
  const research: Action = {
    label: researchBusy ? "调研中…" : "发起深度调研",
    icon: researchBusy ? Loader2 : Sparkles,
    disabled: researchBusy,
    busy: researchBusy,
    onSelect: onResearch,
  };
  const primary: Action = researched
    ? {
        label: "阅读研报",
        icon: BookOpen,
        onSelect: onViewReport,
        href: article.research?.wiki_url,
      }
    : reviewed
      ? research
      : review;
  const secondary: Action[] = [researched || reviewed ? review : research];
  if (researched) {
    secondary.push({
      label: article.research?.archived_at ? "重新发起深度调研" : "重试归档",
      icon: RotateCw,
      onSelect: onResearch,
    });
  }
  const PrimaryIcon = primary.icon;
  const primaryColor = researched
    ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
    : reviewed
      ? "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
      : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100";

  return (
    <div className="flex shrink-0 items-center gap-1">
      {primary.href ? (
        <a
          href={primary.href}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-xs font-medium shadow-sm transition-colors ${primaryColor}`}
        >
          <PrimaryIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {primary.label}
        </a>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={primary.disabled}
          onClick={primary.onSelect}
          className={`gap-1.5 ${primaryColor}`}
        >
          <PrimaryIcon
            className={`h-3.5 w-3.5 ${primary.busy ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {primary.label}
        </Button>
      )}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-neutral-500"
            aria-label={`更多操作：${article.title}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            collisionPadding={12}
            onCloseAutoFocus={(event) => {
              if (document.querySelector('[role="dialog"]'))
                event.preventDefault();
            }}
            className="z-50 min-w-40 rounded-lg border bg-white p-1 shadow-lg"
          >
            {secondary.map(
              ({ label, icon: Icon, disabled, busy, onSelect }) => (
                <DropdownMenu.Item
                  key={label}
                  disabled={disabled}
                  onSelect={onSelect}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-xs text-neutral-600 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-neutral-100"
                >
                  <Icon
                    className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  {label}
                </DropdownMenu.Item>
              ),
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
