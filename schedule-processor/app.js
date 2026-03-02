const axios = require('axios');
const crypto = require('crypto');
const AWS = require('aws-sdk');

const stepFunctions = new AWS.StepFunctions();

function buildExecutionName(scheduleId, leaseOwner) {
  const key = `${scheduleId}:${leaseOwner}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return `sched-${hash.slice(0, 64)}`;
}

async function fetchReadySchedules() {
  const semaphorAppUrl = process.env.SEMAPHOR_APP_URL;
  const lambdaApiKey = process.env.LAMBDA_API_KEY;

  if (!semaphorAppUrl) {
    throw new Error('Missing required environment variable: SEMAPHOR_APP_URL');
  }
  if (!lambdaApiKey) {
    throw new Error('Missing required environment variable: LAMBDA_API_KEY');
  }

  const apiUrl = `${semaphorAppUrl}/api/v1/schedules/ready`;
  const response = await axios.get(apiUrl, {
    headers: {
      'X-API-Key': lambdaApiKey,
    },
  });

  return Array.isArray(response.data) ? response.data : [];
}

function hasAttachments(schedule) {
  return Array.isArray(schedule?.attachments) && schedule.attachments.length > 0;
}

async function enqueueConsolidatedSchedule(schedule) {
  const stateMachineArn = process.env.SCHEDULE_DELIVERY_STATE_MACHINE_ARN;
  if (!stateMachineArn) {
    throw new Error('SCHEDULE_DELIVERY_STATE_MACHINE_ARN is not configured');
  }

  const scheduleId =
    typeof schedule?.scheduleId === 'string' ? schedule.scheduleId.trim() : '';
  const leaseOwner =
    typeof schedule?.leaseOwner === 'string' ? schedule.leaseOwner.trim() : '';

  if (!scheduleId) {
    throw new Error('Schedule payload missing scheduleId');
  }
  if (!leaseOwner) {
    throw new Error(`Schedule ${scheduleId} missing leaseOwner`);
  }

  const executionName = buildExecutionName(scheduleId, leaseOwner);

  try {
    const startResult = await stepFunctions
      .startExecution({
        stateMachineArn,
        name: executionName,
        input: JSON.stringify(schedule),
      })
      .promise();

    return {
      scheduleId,
      status: 'enqueued',
      executionArn: startResult.executionArn,
      executionName,
    };
  } catch (error) {
    if (error?.code === 'ExecutionAlreadyExists') {
      return {
        scheduleId,
        status: 'duplicate',
        executionName,
      };
    }
    throw error;
  }
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

exports.handler = async () => {
  try {
    const schedules = await fetchReadySchedules();

    if (schedules.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No schedules to process' }),
      };
    }

    const schedulesToRun = [];
    const skippedResults = [];

    for (const schedule of schedules) {
      if (!hasAttachments(schedule)) {
        skippedResults.push({
          scheduleId:
            typeof schedule?.scheduleId === 'string'
              ? schedule.scheduleId
              : 'unknown',
          status: 'skipped_no_attachments',
        });
        continue;
      }
      schedulesToRun.push(schedule);
    }

    const enqueueSettled = await Promise.allSettled(
      schedulesToRun.map((schedule) => enqueueConsolidatedSchedule(schedule))
    );
    const enqueueResults = enqueueSettled.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      const schedule = schedulesToRun[index];
      const scheduleId =
        typeof schedule?.scheduleId === 'string' ? schedule.scheduleId : 'unknown';
      return {
        scheduleId,
        status: 'enqueue_error',
        error: toErrorMessage(result.reason),
      };
    });

    const results = [...enqueueResults, ...skippedResults];
    const enqueueErrorCount = enqueueResults.filter(
      (item) => item.status === 'enqueue_error'
    ).length;

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Schedule processing completed',
        count: schedules.length,
        enqueuedCount: schedulesToRun.length,
        skippedCount: skippedResults.length,
        enqueueErrorCount,
        results,
      }),
    };
  } catch (error) {
    console.error('Error processing schedules:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error processing schedules',
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
