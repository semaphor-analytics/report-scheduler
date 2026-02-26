const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return null;
  }

  return process.argv[index + 1];
}

function usage() {
  console.error(
    'Usage: EMAIL_EXTERNAL_AUTH_SECRET=<secret> node resend-provider/scripts/generate-signed-event.js [--payload <path>] [--out <path>]'
  );
}

const secret = process.env.EMAIL_EXTERNAL_AUTH_SECRET || getArg('--secret');
if (!secret) {
  usage();
  console.error('Error: EMAIL_EXTERNAL_AUTH_SECRET (or --secret) is required.');
  process.exit(1);
}

const payloadPath =
  getArg('--payload') ||
  path.join(__dirname, '..', 'events', 'payload.sample.json');

let payloadBody;
try {
  const payloadRaw = fs.readFileSync(payloadPath, 'utf8');
  payloadBody = JSON.stringify(JSON.parse(payloadRaw));
} catch (error) {
  console.error(`Error: failed to read/parse payload file at ${payloadPath}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const timestamp = String(Date.now());
const signature = crypto
  .createHmac('sha256', secret)
  .update(`${timestamp}.${payloadBody}`)
  .digest('hex');

const event = {
  headers: {
    'Content-Type': 'application/json',
    'X-Semaphor-Timestamp': timestamp,
    'X-Semaphor-Signature': signature,
  },
  isBase64Encoded: false,
  body: payloadBody,
};

const output = JSON.stringify(event, null, 2);
const outPath = getArg('--out');

if (outPath) {
  fs.writeFileSync(outPath, `${output}\n`, 'utf8');
  console.error(`Wrote signed event to ${outPath}`);
} else {
  process.stdout.write(`${output}\n`);
}
