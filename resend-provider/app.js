const crypto = require('crypto');
const { Resend } = require('resend');

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

function getHeader(headers, key) {
  if (!headers) {
    return undefined;
  }

  const normalizedKey = key.toLowerCase();
  for (const [headerKey, value] of Object.entries(headers)) {
    if (headerKey.toLowerCase() === normalizedKey) {
      return value;
    }
  }

  return undefined;
}

function decodeRawBody(event) {
  if (typeof event?.body === 'string') {
    if (event.isBase64Encoded) {
      return Buffer.from(event.body, 'base64').toString('utf8');
    }

    return event.body;
  }

  // Supports direct invocation in tests
  if (event && typeof event === 'object') {
    return JSON.stringify(event);
  }

  return null;
}

function timingSafeHexEqual(a, b) {
  try {
    const left = Buffer.from(String(a || ''), 'hex');
    const right = Buffer.from(String(b || ''), 'hex');

    if (left.length === 0 || right.length === 0 || left.length !== right.length) {
      return false;
    }

    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function verifySignature({ secret, timestamp, signature, rawBody }) {
  if (!secret) {
    return {
      ok: false,
      statusCode: 500,
      error: 'EMAIL_EXTERNAL_AUTH_SECRET is required',
    };
  }

  if (!timestamp || !signature) {
    return { ok: false, statusCode: 401, error: 'Missing signature headers' };
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, statusCode: 401, error: 'Invalid timestamp header' };
  }

  if (Math.abs(Date.now() - timestampMs) > SIGNATURE_MAX_AGE_MS) {
    return { ok: false, statusCode: 401, error: 'Signature timestamp expired' };
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  if (!timingSafeHexEqual(expected, signature)) {
    return { ok: false, statusCode: 401, error: 'Invalid signature' };
  }

  return { ok: true };
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'Payload must be an object';
  }

  if (!payload.subject || typeof payload.subject !== 'string') {
    return 'subject is required';
  }

  if (!Array.isArray(payload.to) || payload.to.length === 0) {
    return 'to[] is required';
  }

  if (
    !payload.attachment ||
    typeof payload.attachment !== 'object' ||
    !payload.attachment.presignedUrl ||
    !payload.attachment.name
  ) {
    return 'attachment with presignedUrl and name is required';
  }

  if (!payload.html && !payload.text) {
    return 'Either html or text is required';
  }

  return null;
}

exports.handler = async (event) => {
  const rawBody = decodeRawBody(event);
  if (!rawBody) {
    return jsonResponse(400, {
      success: false,
      error: 'Request body is required',
    });
  }

  const headers = event?.headers || {};
  const signatureResult = verifySignature({
    secret: process.env.EMAIL_EXTERNAL_AUTH_SECRET || '',
    timestamp: getHeader(headers, 'X-Semaphor-Timestamp'),
    signature: getHeader(headers, 'X-Semaphor-Signature'),
    rawBody,
  });

  if (!signatureResult.ok) {
    return jsonResponse(signatureResult.statusCode || 401, {
      success: false,
      error: signatureResult.error,
    });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, {
      success: false,
      error: 'Invalid JSON body',
    });
  }

  const payloadError = validatePayload(payload);
  if (payloadError) {
    return jsonResponse(400, {
      success: false,
      error: payloadError,
    });
  }

  if (!process.env.RESEND_API_KEY) {
    return jsonResponse(500, {
      success: false,
      error: 'RESEND_API_KEY is not configured',
    });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const attachmentResponse = await fetch(payload.attachment.presignedUrl);
    if (!attachmentResponse.ok) {
      throw new Error(
        `Failed to download attachment: HTTP ${attachmentResponse.status}`
      );
    }

    const attachmentBuffer = Buffer.from(await attachmentResponse.arrayBuffer());

    const sendResponse = await resend.emails.send({
      from: process.env.RESEND_SENDER_EMAIL || payload.from,
      to: payload.to,
      subject: payload.subject,
      ...(payload.text ? { text: payload.text } : {}),
      ...(payload.html ? { html: payload.html } : {}),
      attachments: [
        {
          filename: payload.attachment.name,
          content: attachmentBuffer,
        },
      ],
    });

    if (sendResponse.error) {
      return jsonResponse(502, {
        success: false,
        error: sendResponse.error.message || 'Resend send failed',
      });
    }

    return jsonResponse(200, {
      success: true,
      providerMessageId: sendResponse.data?.id || null,
    });
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
