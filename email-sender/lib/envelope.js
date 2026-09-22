const { parseEmailAddress } = require('./branding');

function stripHeaderLineBreaks(value) {
  return String(value ?? '').replace(/[\r\n]+/gu, '');
}

function encodeRfc2047Header(value) {
  const normalized = stripHeaderLineBreaks(value);
  if (/^[\x00-\x7f]*$/u.test(normalized)) {
    return normalized;
  }

  const chunks = [];
  let chunk = '';
  for (const character of normalized) {
    if (chunk && Buffer.byteLength(chunk + character, 'utf8') > 30) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += character;
  }
  if (chunk) {
    chunks.push(chunk);
  }

  return chunks
    .map(
      (part) => `=?UTF-8?B?${Buffer.from(part, 'utf8').toString('base64')}?=`
    )
    .join(' ');
}

function parseConfiguredSender(configuredSender) {
  const safeSender = stripHeaderLineBreaks(configuredSender).trim();
  const openingAngle = safeSender.lastIndexOf('<');
  const closingAngle = safeSender.endsWith('>') ? safeSender.length - 1 : -1;

  if (openingAngle >= 0 && closingAngle > openingAngle) {
    const address = safeSender.slice(openingAngle + 1, closingAngle).trim();
    parseEmailAddress(address, 'configuredSender');
    return {
      address,
      displayName: safeSender.slice(0, openingAngle).trim() || null,
    };
  }

  parseEmailAddress(safeSender, 'configuredSender');
  return { address: safeSender, displayName: null };
}

function formatMailbox(displayName, address) {
  const safeAddress = parseEmailAddress(
    stripHeaderLineBreaks(address).trim(),
    'fromAddress'
  );
  if (!displayName) {
    return safeAddress;
  }

  const safeDisplayName = stripHeaderLineBreaks(displayName);
  const formattedDisplayName = /^[\x00-\x7f]*$/u.test(safeDisplayName)
    ? /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/u.test(safeDisplayName)
      ? safeDisplayName
      : `"${safeDisplayName.replace(/\\/gu, '\\\\')}"`
    : encodeRfc2047Header(safeDisplayName);
  return `${formattedDisplayName} <${safeAddress}>`;
}

function resolveEnvelope({
  configuredSender,
  fromAddress = null,
  branding = null,
  recipient,
  subject,
}) {
  const configured = parseConfiguredSender(configuredSender);
  const resolvedFromAddress = fromAddress
    ? parseEmailAddress(fromAddress, 'fromAddress')
    : configured.address;
  const toAddress = stripHeaderLineBreaks(recipient).trim();
  if (!toAddress || !toAddress.includes('@')) {
    throw new Error('recipient is invalid');
  }
  const fromName = branding?.fromName || null;
  const replyTo = branding?.replyTo || null;
  const candidateBcc = branding?.bcc || null;
  const bcc =
    candidateBcc && candidateBcc.toLowerCase() !== toAddress.toLowerCase()
      ? candidateBcc
      : null;

  return {
    brandingVersion: branding?.version || null,
    from: branding
      ? formatMailbox(fromName, resolvedFromAddress)
      : fromAddress
        ? formatMailbox(configured.displayName, resolvedFromAddress)
        : configured.displayName && /[^\x00-\x7f]/u.test(configured.displayName)
          ? formatMailbox(configured.displayName, configured.address)
          : stripHeaderLineBreaks(configuredSender).trim(),
    fromName,
    fromAddress: resolvedFromAddress,
    to: [toAddress],
    replyTo,
    bcc,
    // Keep the provider-facing subject as clean Unicode. Raw MIME owns
    // RFC 2047 encoding; JSON API providers must receive the original text.
    subject: stripHeaderLineBreaks(subject),
  };
}

module.exports = {
  encodeRfc2047Header,
  formatMailbox,
  parseConfiguredSender,
  resolveEnvelope,
  stripHeaderLineBreaks,
};
