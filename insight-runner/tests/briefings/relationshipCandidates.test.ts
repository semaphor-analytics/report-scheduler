import { describe, expect, it } from "vitest";
import {
  buildRelatedSemanticSchemaDiscoveryCalls,
  type AnswerSlot,
  type GroundedSchema,
} from "../../src/briefings/answerContract.js";
import { EvidenceLedger } from "../../src/evidence/evidenceLedger.js";

// Relationships arrive from `semaphor_get_domain_relationships` in the domain
// template 2.1 shape: `from` is the many side, `to` the key side. A stored 2.0
// `one_to_many` (facilities -> inventory_movements) arrives reversed, as
// `from: inventory_movements, to: facilities, many_to_one`, so both directions
// below cover it: each end still finds the other.

const slot: AnswerSlot = {
  id: "movement_by_region",
  type: "analysis_table",
  subject: "quantity",
  prompt: "Inventory movement quantity by region",
  entityCandidates: ["inventory_movements"],
  dateFieldCandidates: [],
  displayFieldCandidates: ["quantity", "region"],
  required: true,
};

function relatedCalls(relationship: Record<string, unknown>) {
  const ledger = new EvidenceLedger("run_test");
  ledger.recordToolCall({
    purpose: "List semantic relationships.",
    call: {
      name: "semaphor_get_domain_relationships",
      arguments: { domainId: "domain_inventory" },
    },
    result: {
      toolName: "semaphor_get_domain_relationships",
      ok: true,
      data: { relationships: [relationship] },
    },
  });
  const evidence = ledger.snapshot();
  const schema: GroundedSchema = {
    entry: evidence.entries[0]!,
    semanticDomainId: "domain_inventory",
    datasetName: "inventory_movements",
    tableName: "inventory_movements",
    fieldNames: ["facility_id", "quantity"],
    metricFields: ["quantity"],
    dimensionFields: ["facility_id"],
    dateFields: [],
  };
  return buildRelatedSemanticSchemaDiscoveryCalls({
    slot,
    schema,
    evidence,
    maxCalls: 3,
  });
}

describe("related semantic datasets from 2.1 relationships", () => {
  const expected = [
    expect.objectContaining({
      name: "semaphor_get_dataset_schema",
      arguments: { domainId: "domain_inventory", datasetName: "facilities" },
    }),
  ];

  it("finds the key-side dataset from the many side", () => {
    expect(
      relatedCalls({
        id: "rel_1",
        from: { dataset: "inventory_movements", fields: ["facility_id"] },
        to: { dataset: "facilities", fields: ["facility_id"] },
        cardinality: "many_to_one",
      }),
    ).toEqual(expected);
  });

  it("finds the many-side dataset from the key side", () => {
    const ledger = new EvidenceLedger("run_test");
    ledger.recordToolCall({
      purpose: "List semantic relationships.",
      call: {
        name: "semaphor_get_domain_relationships",
        arguments: { domainId: "domain_inventory" },
      },
      result: {
        toolName: "semaphor_get_domain_relationships",
        ok: true,
        data: {
          relationships: [
            {
              id: "rel_1",
              from: { dataset: "inventory_movements", fields: ["facility_id"] },
              to: { dataset: "facilities", fields: ["facility_id"] },
              cardinality: "many_to_one",
            },
          ],
        },
      },
    });
    const evidence = ledger.snapshot();
    const calls = buildRelatedSemanticSchemaDiscoveryCalls({
      slot: {
        ...slot,
        subject: "facility_count",
        entityCandidates: ["facilities"],
        displayFieldCandidates: ["facility_count", "movement_type"],
      },
      schema: {
        entry: evidence.entries[0]!,
        semanticDomainId: "domain_inventory",
        datasetName: "facilities",
        tableName: "facilities",
        fieldNames: ["facility_id", "facility_region", "facility_count"],
        metricFields: ["facility_count"],
        dimensionFields: ["facility_id", "facility_region"],
        dateFields: [],
      },
      evidence,
      maxCalls: 3,
    });
    expect(calls.map((call) => call.arguments)).toEqual([
      { domainId: "domain_inventory", datasetName: "inventory_movements" },
    ]);
  });

  it("ignores 2.0-shaped relationship ends", () => {
    expect(
      relatedCalls({
        id: "rel_3",
        sourceDataset: "inventory_movements",
        sourceFields: ["facility_id"],
        targetDataset: "facilities",
        targetFields: ["facility_id"],
        cardinality: "many_to_one",
      }),
    ).toEqual([]);
  });
});
