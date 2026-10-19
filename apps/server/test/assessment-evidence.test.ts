import { expect, it } from 'vitest';
import { hasGroundedEvidence } from '../src/modules/processing/assessment.js';

const material = 'Restock raises an [interrupt](https://docs.example.com/interrupts) for this review, so the run stays paused until the user clicks Approve or Reject in Slack.';
it('accepts verbatim visible text when the source contains Markdown links', () => {
  expect(hasGroundedEvidence({evidence_refs:['Restock raises an interrupt for this review, so the run stays paused until the user clicks Approve or Reject in Slack.']}, material)).toBe(true);
});
it('continues to reject invented, partial and too-short evidence', () => {
  for (const evidence_refs of [[],['interrupt'],['Restock automatically approves every order in Slack.'],['Restock raises an interrupt for this review, so the run stays paused until the user clicks Approve or Reject in Slack.','The model handles payment secrets directly.']]) {
    expect(hasGroundedEvidence({evidence_refs},material)).toBe(false);
  }
});
it('normalizes visual emphasis and inline code without changing numbers or wording', () => {
  const article='SFT raised F1 from **48.9% to 53.7%**, using *29.8% fewer model calls* through `train_agent`.';
  const quote='SFT raised F1 from 48.9% to 53.7%, using 29.8% fewer model calls through train_agent.';
  expect(hasGroundedEvidence({evidence_refs:[quote]},article)).toBe(true);
  expect(hasGroundedEvidence({evidence_refs:[quote.replace('53.7%','99.7%')]},article)).toBe(false);
});
