# Briefing Contract Execution Plan

## Goal

Create a first-class Briefing Contract that carries user intent through answer coverage, presentation coverage, artifact rendering, and delivery adaptation.

A briefing run should not be considered complete until required answer slots are covered and requested presentation slots are either produced or explicitly marked unsupported with a reason.

This runner contract is a hard cutover. It is not production-customer compatible yet, so do not add migration shims, legacy Briefing Contract compatibility paths, dual-write behavior, or long-lived fallback contracts.

Hard database rule: do not edit `schema.prisma`, do not add Prisma migration files, do not run Prisma migration commands, and do not add manual SQL/DDL for this work.

## Mental Model

- Questions drive evidence.
- Presentation preferences drive report blocks.
- Delivery channels drive rendering constraints.
- The contract orchestrates the pipeline; model calls help normalize, plan, and write, but they should not be the source of truth for required coverage.

## Phase 1: Define The Contract

- [x] Create `briefingContract.ts` as the canonical contract wrapper for briefing runs.
- [x] Fold the existing answer contract into the new contract as `answerSlots`.
- [x] Add `presentationSlots` for requested output forms such as KPI, table, chart, progress bar, and narrative summary.
- [x] Add `artifactTargets` for requested artifacts such as markdown and HTML.
- [x] Add `deliveryTargets` for Slack, email, briefing page, and future channels.
- [x] Add `qualityGates` that describe required answer and presentation coverage before completion.
- [x] Emit a trace event with the full normalized contract shape.

## Phase 2: Normalize User Intent

- [x] Extend intent normalization to extract presentation preferences from natural language.
- [x] Detect explicit preferences: KPI, table, chart, graph, progress bar, scorecard, concise summary.
- [x] Detect artifact capabilities so HTML/PDF/Markdown support can be considered during presentation coverage.
- [x] Preserve uncertainty when a preference is ambiguous instead of inventing a visualization.
- [x] Add tests for briefing prompts that mix questions, KPI requests, tables, and multiple delivery channels.

## Phase 3: Enforce Answer Coverage

- [x] Keep answer slots as deterministic obligations, not suggestions.
- [x] Require each slot to declare required fields, time window, grain, grouping, and success criteria where known.
- [x] Ensure every slot-answering query purpose carries `[slot:<slotId>]`.
- [x] Reject partial evidence that lacks required fields, even if it returns rows.
- [x] Run targeted recovery for missing answer slots before synthesis.
- [x] Keep limitations specific to the missing slot when recovery fails.

## Phase 4: Enforce Presentation Coverage

- [x] Add `assessPresentationCoverage(contract, reportPlan)`.
- [x] Require KPI `metric` blocks when the user asks for KPIs and the artifact target supports them.
- [x] Require `table` blocks when the user asks to see the answer in a table.
- [x] Require chart blocks when the user asks for charts and the evidence shape supports a chart.
- [x] Add a repair path that can derive missing blocks from existing evidence before final rendering.
- [x] Record explicit presentation limitations when a requested form cannot be produced.

## Phase 5: Build A Canonical Report Document

- [x] Introduce a channel-neutral `ReportDocument` as the canonical output after evidence coverage.
- [x] Represent facts as structured sections: summary, KPIs, charts, tables, findings, limitations, evidence.
- [x] Convert existing `ReportPlan` blocks into the new document shape.
- [x] Keep model composition limited to ordering, titles, and concise narrative.
- [x] Ensure Briefing package HTML/text rendering consumes the typed document, not raw model prose.

## Phase 6: Channel-Specific Rendering

- [x] Define channel capability profiles for Slack, email, HTML, markdown, and PDF.
- [x] Slack profile: compact summary, short bullets, small table preview, links or thread detail for longer evidence.
- [x] Email profile: responsive HTML, mobile-safe tables, inline-safe styling, KPI cards when available.
- [x] HTML artifact profile: richer KPI, chart, table, and evidence layout.
- [x] Markdown profile: plain fallback for all structured blocks.
- [x] PDF profile: print-safe layout and bounded table widths.
- [x] `includeEvidence` and `includeSql` materialize canonical
      `evidence_appendix` and `sql` content blocks for artifacts. Slack remains
      a concise projection and does not inline evidence appendices or raw SQL.

## Phase 7: Observability And Quality Gates

- [x] Trace contract creation, answer coverage, presentation coverage, repairs, and channel adaptation.
- [x] Make final run manifest include contract status and coverage status.
- [x] Add warnings when answer coverage passes but presentation coverage fails.
- [x] Add regression tests using the “profit and sales KPI, top products, shipping delay, transport mode, state table” prompt.
- [x] Add negative tests proving partial profit-only evidence cannot pass.

## Phase 8: Migration And Cleanup

- [x] Remove old answer-contract-only orchestration from runner call sites once the broader Briefing Contract owns the run.
- [x] Move requested presentation inference into the Briefing Contract; keep evidence-shape block extraction in `reportBlocks.ts`.
- [x] Reduce renderer-specific branching by routing Briefing package HTML/text through the typed report document.
- [x] Remove duplicated fallback behavior once the new contract gates are stable.
- [x] Update runner documentation with the Briefing Contract mental model.

## Hard Cutover Rules

- [x] No migration shims or legacy Briefing Contract compatibility paths.
- [x] No dual-write or dual-read contract behavior.
- [x] No `schema.prisma` edits.
- [x] No Prisma migration files.
- [x] No Prisma migration commands.
- [x] No manual SQL/DDL.

## Tracking Checklist

- [x] Contract file created and wired into `runInsightLoop`.
- [x] Intent normalization produces presentation preferences.
- [x] Answer coverage gates all required answer slots.
- [x] Presentation coverage gates requested output forms.
- [x] KPI requests produce metric blocks for HTML-capable outputs.
- [x] Table requests produce business table blocks or explicit limitations.
- [x] Slack, email, HTML, and markdown have channel profiles and document-backed rendering constraints.
- [x] Trace and manifest expose contract and coverage status.
- [x] Regression tests cover the known bad run pattern.
- [x] Documentation updated.
