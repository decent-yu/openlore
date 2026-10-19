import { z } from "zod";

export const LibraryTimeRangeSchema = z.enum([
  "all",
  "today",
  "3days",
  "custom",
]);
export type LibraryTimeRange = z.infer<typeof LibraryTimeRangeSchema>;
export const LibraryStatusFilterSchema = z.enum([
  "all",
  "unselected",
  "selected",
  "deep",
]);
export type LibraryStatusFilter = z.infer<typeof LibraryStatusFilterSchema>;
const date = z.string().date("请选择有效日期（YYYY-MM-DD）").optional();

export const LibraryQuerySchema = z
  .object({
    time_range: LibraryTimeRangeSchema.default("all"),
    discovered_from: date,
    discovered_to: date,
    published_range: LibraryTimeRangeSchema.default("all"),
    published_from: date,
    published_to: date,
    status_filter: LibraryStatusFilterSchema.default("all"),
    interested_only: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    source_id: z.string().trim().default(""),
    group_id: z.string().trim().default(""),
    search: z.string().trim().default(""),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(12),
  })
  .superRefine((value, context) => {
    for (const [range, from, to, field] of [
      [
        value.time_range,
        value.discovered_from,
        value.discovered_to,
        "discovered_from",
      ],
      [
        value.published_range,
        value.published_from,
        value.published_to,
        "published_from",
      ],
    ] as const) {
      if (range !== "custom") continue;
      if (!from || !to)
        context.addIssue({
          code: "custom",
          path: [field],
          message: "请选择开始日期和结束日期",
        });
      else if (from > to)
        context.addIssue({
          code: "custom",
          path: [field],
          message: "开始日期不能晚于结束日期",
        });
    }
  });

export interface LibraryFilterParams {
  time_range?: LibraryTimeRange;
  discovered_from?: string;
  discovered_to?: string;
  published_range?: LibraryTimeRange;
  published_from?: string;
  published_to?: string;
  status_filter?: LibraryStatusFilter;
  interested_only?: boolean;
  source_id?: string;
  group_id?: string;
  search?: string;
  page?: number;
  page_size?: number;
}
