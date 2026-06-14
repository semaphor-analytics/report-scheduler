# Operational Anomaly Review

## Goal
Find unusual operational movement from the last completed day and explain what
likely changed.

## Questions To Answer
- Which metrics moved outside their recent normal range?
- Which teams, regions, queues, products, or workflows explain the movement?
- Is this likely a data issue, one-time event, or operational trend?

## Business Context
- Use recent history as the baseline.
- Prefer simple explainable comparisons first.
- Use deeper SQL or Python analysis only when it materially improves the answer.

## Output
Write a Markdown incident-style review with findings, evidence, uncertainty,
and recommended follow-up.

## Guardrails
- Do not trigger alerts or send messages.
- Do not pull large raw datasets unless there is a clear reason and row limit.
- Label any unsupported interpretation as a hypothesis.
