import { readFileSync } from 'fs';
import path from 'path';
import jsonata from 'jsonata';

describe('export state machine retry policy', () => {
  it('reuses existing workers for bounded continuation and finalization retries', () => {
    const definition = JSON.parse(readFileSync(path.resolve(__dirname, '../statemachine/export.asl.json'), 'utf8'));
    const { States: states } = definition;
    expect(states.ProcessMatrixBatch.Resource).toBe('${ChunkProcessorArn}');
    expect(states.ProcessMatrixBatch.ResultPath).toBe('$.continuation');
    expect(states.MatrixExhausted.Choices[0].Next).toBe('ResetMatrixFinalizationRetry');
    expect(states.CompactMatrixAndNotify.Resource).toBe('${CompactionProcessorArn}');
    expect(states.CompactMatrixAndNotify.Retry).toBeUndefined();
    expect(states.ProcessMatrixBatch.Retry).toBeUndefined();
    expect(states.ProcessMatrixBatch.Parameters['deadlineAt.$']).toBe('$.deadlineAt');
    expect(states.CompactMatrixAndNotify.Parameters['deadlineAt.$']).toBe('$.deadlineAt');
    expect(states.CompactMatrixAndNotify.Catch[0].ErrorEquals).toEqual(['ExportQueryRejectedError']);
    expect(states.ProcessMatrixBatch.Catch[0].ErrorEquals).toEqual(['ExportQueryRejectedError']);
    expect(states.InvalidMatrixDeadline.Next).toBe('MarkExportFailed');
    expect(states.ProcessMatrixBatch.Catch[0].Next).toBe('MarkExportFailed');
    expect(states.CompactMatrixAndNotify.Catch[0].Next).toBe('MarkExportFailed');
    expect(definition.TimeoutSeconds).toBeUndefined();
    expect(states.CompactAndNotify.Retry).toBeUndefined();
  });

  it('evaluates bounded Matrix retry waits, counters and completed-only dispatch against a fake clock', async () => {
    const { States: states } = JSON.parse(readFileSync(path.resolve(__dirname, '../statemachine/export.asl.json'), 'utf8'));
    let now = 1_800_000_000_000;
    const evaluate = (expression: string, input: object) => {
      const query = jsonata(expression.slice(2, -2));
      query.assign('millis', () => now);
      return query.evaluate({}, { states: { input } });
    };
    const input = { deadlineAt: now + 100, matrixRetry: { count: 0, phase: 'batch', replayOnly: false }, continuation: { sequence: 2 } };
    expect(Date.parse(await evaluate(states.WaitMatrixRetry.Timestamp, input))).toBe(input.deadlineAt);
    for (let count = 0; count < 3; count++) {
      const ample = { ...input, deadlineAt: now + 100_000, matrixRetry: { ...input.matrixRetry, count } };
      expect(Date.parse(await evaluate(states.WaitMatrixRetry.Timestamp, ample))).toBe(now + 5000 * 2 ** count);
    }
    now += 100;
    expect(await evaluate(states.DispatchMatrixAttempt.Choices[0].Condition, input)).toBe(true);
    expect(states.DispatchMatrixAttempt.Choices[0].Next).toBe('ResetMatrixFinalizationRetry');
    const incremented = await evaluate(states.IncrementMatrixRetry.Output, input);
    expect(incremented.matrixRetry.count).toBe(1);
    expect(incremented.deadlineAt).toBe(input.deadlineAt);
    expect(incremented.continuation).toEqual(input.continuation);
    expect(await evaluate(states.CanRetryMatrix.Choices[0].Condition, { ...input, matrixRetry: { ...input.matrixRetry, count: 3 } })).toBe(false);
    const replay = await evaluate(states.StampMatrixFinalizationAttempt.Output, { ...input, matrixRetry: { count: 0, phase: 'finalization' } });
    expect(replay.matrixRetry.replayOnly).toBe(true);
    expect(await evaluate(states.CanRetryMatrix.Choices[0].Condition, replay)).toBe(false);
    expect(states.CanRetryMatrix.Default).toBe('MarkExportFailed');
  });
  it('does not retry deterministic query rejections and retains transient retries', () => {
    const definition = JSON.parse(
      readFileSync(
        path.resolve(__dirname, '../statemachine/export.asl.json'),
        'utf8',
      ),
    );
    const retry =
      definition.States.ProcessChunks.ItemProcessor.States.ProcessSingleChunk
        .Retry;

    expect(retry).toEqual([
      {
        ErrorEquals: ['ExportQueryRejectedError'],
        MaxAttempts: 0,
      },
      {
        ErrorEquals: ['States.ALL'],
        MaxAttempts: 3,
        BackoffRate: 2,
        IntervalSeconds: 5,
      },
    ]);
  });
});
