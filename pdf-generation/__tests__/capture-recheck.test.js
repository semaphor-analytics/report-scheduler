import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyRecheckResult,
  recheckReadyBeforeCapture,
} from '../lib/content-stability.js';

// Runs the in-page function against a fake window, so the polling logic itself
// is under test.
let readyState;
let renderError;
let onFrames;
const page = { evaluate: (fn, ...args) => fn(...args) };

beforeEach(() => {
  readyState = undefined;
  renderError = null;
  onFrames = () => {};
  vi.stubGlobal('window', {
    get __SEMAPHOR_READY__() {
      return readyState;
    },
  });
  vi.stubGlobal('document', { querySelector: () => renderError });
  let frames = 0;
  vi.stubGlobal('requestAnimationFrame', (callback) =>
    setTimeout(() => {
      frames += 1;
      if (frames === 2) onFrames();
      callback();
    }, 0),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const matrixHold = { key: 'matrix:card-1', label: 'Revenue by region' };

describe('recheckReadyBeforeCapture', () => {
  it('returns promptly once ready holds for the stable window', async () => {
    readyState = { ready: true, holds: [] };
    const result = await recheckReadyBeforeCapture(page, { timeoutMs: 2000, stableMs: 150 });
    expect(result.ready).toBe(true);
    expect(result.waitedMs).toBeGreaterThanOrEqual(150);
    expect(result.waitedMs).toBeLessThan(1000);
  });

  it('waits for a hold that appears after the resize frames', async () => {
    readyState = { ready: true, holds: [] };
    onFrames = () => {
      readyState = { ready: false, holds: [matrixHold] };
      setTimeout(() => {
        readyState = { ready: true, holds: [] };
      }, 250);
    };
    const result = await recheckReadyBeforeCapture(page, { timeoutMs: 2000, stableMs: 100 });
    expect(result.ready).toBe(true);
    expect(result.waitedMs).toBeGreaterThanOrEqual(250);
  });

  it('does not accept a ready flag that flickers off inside the stable window', async () => {
    readyState = { ready: true, holds: [] };
    setTimeout(() => {
      readyState = { ready: false, holds: [] };
    }, 120);
    setTimeout(() => {
      readyState = { ready: true, holds: [] };
    }, 260);
    const result = await recheckReadyBeforeCapture(page, { timeoutMs: 2000, stableMs: 200 });
    expect(result.ready).toBe(true);
    expect(result.waitedMs).toBeGreaterThanOrEqual(460);
  });

  it('returns the last published holds on timeout, or none when nothing was published', async () => {
    readyState = { ready: false, holds: [matrixHold] };
    await expect(
      recheckReadyBeforeCapture(page, { timeoutMs: 200, stableMs: 100 }),
    ).resolves.toMatchObject({ ready: false, holds: [matrixHold] });

    readyState = undefined;
    await expect(
      recheckReadyBeforeCapture(page, { timeoutMs: 200, stableMs: 100 }),
    ).resolves.toMatchObject({ ready: false, holds: [] });
  });

  it('fails fast with the delivery-blocking render error', async () => {
    readyState = { ready: false, holds: [matrixHold] };
    renderError = {
      getAttribute: (name) =>
        name === 'data-semaphor-render-error-code'
          ? 'missing_temporal_bucket_metadata'
          : 'Refresh and resave the report.',
    };
    await expect(
      recheckReadyBeforeCapture(page, { timeoutMs: 5000 }),
    ).rejects.toMatchObject({
      code: 'missing_temporal_bucket_metadata',
      deliveryBlocking: true,
    });
  });
});

describe('applyRecheckResult', () => {
  it('captures on ready and reports the wait', () => {
    expect(applyRecheckResult({ ready: true, waitedMs: 320 })).toEqual({
      recheckMs: 320,
      recheckTimedOut: false,
    });
  });

  it('stops the capture with matrix_incomplete naming up to three Matrices', () => {
    const holds = ['A', 'B', 'C', 'D'].map((label, index) => ({
      key: `matrix:${index}`,
      label,
    }));
    let error;
    try {
      applyRecheckResult({ ready: false, waitedMs: 15000, holds }, { timeoutMs: 15000 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('matrix_incomplete');
    expect(error.message).toBe('Matrix "A, B, C" was still loading cells after 15 s');
    // Not delivery-blocking: the Step Functions retry still applies.
    expect(error.deliveryBlocking).toBeUndefined();
  });

  it('captures as today when the timeout has no Matrix hold', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(
      applyRecheckResult({
        ready: false,
        waitedMs: 15000,
        holds: [{ key: 'other:x', label: 'Other' }],
      }),
    ).toEqual({ recheckMs: 15000, recheckTimedOut: true });
  });
});
