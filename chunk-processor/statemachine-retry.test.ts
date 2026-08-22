import { readFileSync } from 'fs';
import path from 'path';

describe('export state machine retry policy', () => {
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
