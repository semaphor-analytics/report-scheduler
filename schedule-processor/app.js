const axios = require('axios');
const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();

exports.handler = async (event) => {
  try {
    // 1. Fetch schedules from API
    const semaphorAppUrl = process.env.SEMAPHOR_APP_URL;

    if (!semaphorAppUrl) {
      console.error(
        'Error: SEMAPHOR_APP_URL environment variable is not set. Please configure the SEMAPHOR_APP_URL in the Lambda environment variables.'
      );
      return {
        statusCode: 500,
        body: JSON.stringify({
          message: 'Configuration error: SEMAPHOR_APP_URL is not set',
          error: 'Missing required environment variable: SEMAPHOR_APP_URL',
        }),
      };
    }

    const apiUrl = `${semaphorAppUrl}/api/v1/schedules/ready`;
    const lambdaApiKey = process.env.LAMBDA_API_KEY;

    if (!lambdaApiKey) {
      console.error('Error: LAMBDA_API_KEY environment variable is not set');
      return {
        statusCode: 500,
        body: JSON.stringify({
          message: 'Configuration error: LAMBDA_API_KEY is not set',
        }),
      };
    }

    const response = await axios.get(apiUrl, {
      headers: {
        'X-API-Key': lambdaApiKey
      }
    });
    const schedules = response.data;

    console.log(schedules);

    if (!schedules || schedules.length === 0) {
      console.log('No schedules to process');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No schedules to process' }),
      };
    }

    // 2. Process each schedule
    const promises = schedules.map(async (schedule) => {
      const {
        scheduleId,
        leaseOwner,
        attachments,
        recipients,
        reportParams,
        pdfExportPreferences,
      } = schedule;

      console.log(`Processing schedule ${scheduleId}:`);
      console.log('  reportParams:', JSON.stringify(reportParams, null, 2));
      console.log('  attachments:', JSON.stringify(attachments, null, 2));
      console.log('  pdfExportPreferences:', JSON.stringify(pdfExportPreferences, null, 2));

      // Skip schedules with no attachments
      if (!attachments || attachments.length === 0) {
        console.warn(`  Schedule ${scheduleId} has no attachments, skipping`);
        return {
          scheduleId,
          status: 'skipped',
          message: 'No attachments to process',
        };
      }

      // Recipients will be passed for S3 tagging
      const recipientList =
        recipients && recipients.length > 0 ? recipients : [];

      const timezone = schedule.timezone || 'UTC'; // Extract timezone from schedule

      console.log('  Recipient List:', recipientList);
      console.log('  Timezone:', timezone);

      // Process each attachment for this schedule
      const attachmentPromises = attachments.map(async (attachment, index) => {
        console.log(
          `  Processing attachment ${index + 1}/${
            attachments.length
          } for schedule ${scheduleId}:`
        );
        console.log('    Type:', attachment.type);
        console.log('    Title:', attachment.title);
        console.log('    Format:', attachment.format);
        console.log('    ViewUrl:', attachment.viewUrl);
        console.log('    Settings:', JSON.stringify(attachment.settings || {}));

        // Extract settings from attachment or fallback to reportParams
        const settings = attachment.settings || {};
        const pageSize =
          settings.pageSize ||
          attachment.pdfOptions?.pageSize ||
          reportParams?.pdfOptions?.pageSize ||
          'letter';
        const orientation =
          settings.orientation ||
          attachment.pdfOptions?.orientation ||
          reportParams?.pdfOptions?.orientation ||
          'portrait';
        const format = attachment.format || 'pdf';

        // Build reportParams from attachment settings for Lambda
        const lambdaReportParams = {};
        if (settings.sheetSelection) {
          lambdaReportParams.sheetSelection = settings.sheetSelection;
        }
        if (settings.includeFilters !== undefined) {
          lambdaReportParams.includeFilters = settings.includeFilters;
        }
        if (settings.includeTimestamp !== undefined) {
          lambdaReportParams.includeTimestamp = settings.includeTimestamp;
        }

        console.log('    Lambda reportParams:', JSON.stringify(lambdaReportParams));

        // Prepare payload for generate-pdf Lambda
        // Include attachment metadata for the email sender to use
        const attachmentMetadata = {
          name: attachment.title,
          type: attachment.type,
          visualId: attachment.visualId,
          dashboardId: attachment.dashboardId,
          format: format,
          attachmentIndex: index,
          totalAttachments: attachments.length,
        };

        // Extract watermark settings from pdfExportPreferences
        const watermarkEnabled = pdfExportPreferences?.watermark?.enabled === true;
        const watermarkText = watermarkEnabled ? (pdfExportPreferences?.watermark?.text || '') : '';
        const headerLogoUrl = pdfExportPreferences?.headerLogo?.enabled
          ? (pdfExportPreferences?.headerLogo?.url || '')
          : '';

        if (watermarkEnabled) {
          console.log(`    Watermark enabled: "${watermarkText}"`);
        }
        if (headerLogoUrl) {
          console.log(`    Header logo enabled`);
        }

        const pdfParams = {
          FunctionName: process.env.GENERATE_PDF_FUNCTION_NAME,
          InvocationType: 'Event', // Asynchronous invocation
          Payload: JSON.stringify({
            queryStringParameters: {
              url: attachment.viewUrl,
              scheduleId: scheduleId,
              leaseOwner: leaseOwner || '',
              email: recipientList.join(','), // Only for S3 tagging as 'recipients'
              pageSize: pageSize,
              orientation: orientation,
              format: format,
              timezone: timezone, // Pass timezone for PDF timestamp formatting
              // Pass attachment metadata for email sender
              attachmentMetadata: JSON.stringify(attachmentMetadata),
              // Pass reportParams if we have any settings
              ...(Object.keys(lambdaReportParams).length > 0 && {
                reportParams: JSON.stringify(lambdaReportParams),
              }),
              // Pass watermark settings
              ...(watermarkEnabled && {
                watermarkEnabled: 'true',
                watermarkText: watermarkText,
              }),
              // Pass header logo URL (for visual-view.tsx rendering)
              ...(headerLogoUrl && {
                headerLogoUrl: headerLogoUrl,
              }),
            },
          }),
        };

        // Invoke generate-pdf Lambda asynchronously for this attachment
        return lambda
          .invoke(pdfParams)
          .promise()
          .then(() => {
            console.log(
              `    Triggered ${format.toUpperCase()} generation for attachment "${
                attachment.title
              }" of schedule ${scheduleId}`
            );
            return {
              scheduleId,
              attachmentName: attachment.title,
              status: 'triggered',
            };
          })
          .catch((error) => {
            console.error(
              `    Error triggering ${format.toUpperCase()} for attachment "${
                attachment.title
              }" of ${scheduleId}:`,
              error
            );
            return {
              scheduleId,
              attachmentName: attachment.title,
              status: 'error',
              error: error.message,
            };
          });
      });

      // Wait for all attachments of this schedule to be processed
      const attachmentResults = await Promise.all(attachmentPromises);
      return {
        scheduleId,
        attachmentResults,
        status: attachmentResults.every((r) => r.status === 'triggered')
          ? 'all_triggered'
          : 'partial',
      };
    });

    // Wait for all invocations to complete
    const results = await Promise.all(promises);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Schedule processing completed',
        results: results,
      }),
    };
  } catch (error) {
    console.error('Error processing schedules:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error processing schedules',
        error: error.message,
      }),
    };
  }
};
