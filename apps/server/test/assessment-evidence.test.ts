import { expect, it } from "vitest";
import {
  hasGroundedEvidence,
  evidenceIssues,
  assessmentMaterial,
} from "../src/modules/processing/assessment.js";
import {
  hasReviewableBody,
  reviewBody,
} from "../src/infrastructure/content/review-body.js";

const material =
  "Restock raises an [interrupt](https://docs.example.com/interrupts) for this review, so the run stays paused until the user clicks Approve or Reject in Slack.";
it("separates metadata from quotable article content and identifies only the failing quotation", () => {
  const wrapped = assessmentMaterial("Example title", material, {});
  expect(wrapped).toContain("元信息（不可作为正文证据）");
  expect(wrapped).toContain("正文（唯一可引用区域）");
  const issues = evidenceIssues(
    { evidence_refs: [material, "Title: Example title"] },
    material,
  );
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({
    path: "evidence_refs[1]",
    code: "ungrounded_evidence",
  });
});
it("recognizes the actual release placeholder without rejecting short substantive releases or legitimate link collections", () => {
  const nav =
    "18th October 2026\n\n## Recent articles\n\n- [Hello Python](https://example.com/python) - 12th October 2026\n- [Another article](https://example.com/other)";
  expect(hasReviewableBody(nav, "Release: llm-tools-datasette 0.1.1")).toBe(
    false,
  );
  expect(
    reviewBody(
      "Adds SQL query tools for Datasette.\n\n" + nav.slice(nav.indexOf("##")),
    ),
  ).toBe("Adds SQL query tools for Datasette.");
  expect(hasReviewableBody("Adds SQL query tools for Datasette.")).toBe(true);
  expect(
    hasReviewableBody(
      "## Useful references\n- [Datasette](https://example.com/)",
    ),
  ).toBe(true);
  expect(
    reviewBody(
      "## Recent articles\nThis section analyzes retrieval over recent articles.",
    ),
  ).toContain("retrieval");
});
it("accepts verbatim visible text when the source contains Markdown links", () => {
  expect(
    hasGroundedEvidence(
      {
        evidence_refs: [
          "Restock raises an interrupt for this review, so the run stays paused until the user clicks Approve or Reject in Slack.",
        ],
      },
      material,
    ),
  ).toBe(true);
});
it("continues to reject invented, partial and too-short evidence", () => {
  for (const evidence_refs of [
    [],
    ["interrupt"],
    ["Restock automatically approves every order in Slack."],
    [
      "Restock raises an interrupt for this review, so the run stays paused until the user clicks Approve or Reject in Slack.",
      "The model handles payment secrets directly.",
    ],
  ]) {
    expect(hasGroundedEvidence({ evidence_refs }, material)).toBe(false);
  }
});
it("normalizes visual emphasis and inline code without changing numbers or wording", () => {
  const article =
    "SFT raised F1 from **48.9% to 53.7%**, using *29.8% fewer model calls* through `train_agent`.";
  const quote =
    "SFT raised F1 from 48.9% to 53.7%, using 29.8% fewer model calls through train_agent.";
  expect(hasGroundedEvidence({ evidence_refs: [quote] }, article)).toBe(true);
  expect(
    hasGroundedEvidence(
      { evidence_refs: [quote.replace("53.7%", "99.7%")] },
      article,
    ),
  ).toBe(false);
});
