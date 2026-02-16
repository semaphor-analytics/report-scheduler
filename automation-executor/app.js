const DEFAULT_EXECUTOR_PATH = '/api/v1/automations/internal/execute';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

exports.handler = async (event = {}) => {
  const baseUrl = requiredEnv('SEMAPHOR_APP_URL');
  const apiKey = requiredEnv('LAMBDA_API_KEY');
  const defaultPath = (process.env.AUTOMATION_EXECUTOR_PATH || DEFAULT_EXECUTOR_PATH).trim();

  if (!event || typeof event !== 'object') {
    throw new Error('State machine input must be an object payload');
  }

  const payload = { ...event };
  const action = typeof payload.action === 'string' ? payload.action : 'execute';
  const path =
    action === 'mark_failed'
      ? `/api/v1/automations/internal/runs/${payload.runId}/fail`
      : defaultPath;
  const requestBody =
    action === 'mark_failed'
      ? { error: payload.error || 'AUTOMATION_EXECUTION_FAILED' }
      : payload;

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(requestBody),
  });

  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok || responseBody.status === 'FAILED') {
    throw new Error(
      typeof responseBody.error === 'string'
        ? responseBody.error
        : `Automation executor failed with HTTP ${response.status}`
    );
  }

  return {
    accepted: true,
    action,
    runId: payload.runId || null,
    ruleId: payload.ruleId || null,
    status: responseBody.status || 'SUCCESS',
    response: responseBody,
  };
};
