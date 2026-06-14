import type {
  InsightLoopDefinition,
  InsightLoopValidationResult,
  ValidationIssue,
} from "./types.js";

export function validateInsightLoopDefinition(
  definition: InsightLoopDefinition,
): InsightLoopValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const intentText = definition.freeformText.trim();

  if (intentText.length < 40) {
    errors.push({
      code: "missing_business_intent",
      message:
        "The instruction file needs a clear business outcome, question, or target business area.",
    });
  }

  if (definition.rawMarkdown.length > 100_000) {
    errors.push({
      code: "instruction_file_too_large",
      message:
        "The instruction file is too large for the local runner. Keep it under 100,000 characters.",
    });
  }

  if (intentText.length < 120) {
    warnings.push({
      code: "thin_instruction",
      message:
        "The instruction file is short; the AI intent normalizer may need to infer missing context.",
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
