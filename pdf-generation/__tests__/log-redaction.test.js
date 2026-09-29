import { describe, expect, it } from 'vitest';
import { redactForLog } from '../lib/log-redaction.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJwcm9qZWN0X2lkIjoicF8xIn0.c2lnbmF0dXJl';
const VIEW_URL = `https://app.example.com/view/dashboard/d_1?token=${JWT}&isPdfRender=true&printRenderRef=render-ref`;

describe('redactForLog', () => {
  it('redacts the token and keeps the rest of the URL readable', () => {
    expect(redactForLog(VIEW_URL)).toBe(
      'https://app.example.com/view/dashboard/d_1?token=[redacted]&isPdfRender=true&printRenderRef=render-ref',
    );
  });

  it('redacts a password and other credential parameters wherever they sit', () => {
    const text = redactForLog(
      'https://pdf.example.com/?format=pdf&password=a%26b%23c&pageSize=a4&X-Amz-Signature=abc123&api_key=k1',
    );

    expect(text).toBe(
      'https://pdf.example.com/?format=pdf&password=[redacted]&pageSize=a4&X-Amz-Signature=[redacted]&api_key=[redacted]',
    );
  });

  it('redacts a URL percent-encoded inside another URL', () => {
    const renderer = `https://pdf.example.com/?url=${encodeURIComponent(VIEW_URL)}&format=pdf`;
    const text = redactForLog(renderer);

    expect(text).not.toContain(JWT);
    expect(text).toContain('%3Ftoken%3D[redacted]%26isPdfRender%3Dtrue');
    expect(text).toContain('&format=pdf');
  });

  it('redacts URLs inside error stacks and messages', () => {
    const error = new Error(`net::ERR_CONNECTION_REFUSED at ${VIEW_URL}`);
    const text = redactForLog(error);

    expect(text).not.toContain(JWT);
    expect(text).toContain('net::ERR_CONNECTION_REFUSED');
    expect(text).toContain('at '); // stack frames kept
  });

  it('never exposes the input of an invalid-URL error', () => {
    let error;
    try {
      new URL(`not a url?token=${JWT}`);
    } catch (caught) {
      error = caught;
    }

    expect(redactForLog(error)).not.toContain(JWT);
  });

  it('leaves look-alike parameter names alone and handles non-strings', () => {
    expect(redactForLog('https://x.test/?tokenId=abc&mytoken=def')).toBe(
      'https://x.test/?tokenId=abc&mytoken=def',
    );
    expect(redactForLog(undefined)).toBe('undefined');
    expect(redactForLog(42)).toBe('42');
  });
});
