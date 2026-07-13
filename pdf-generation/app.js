import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { generatePdf } from './lib/pdf-generator.js';
import { generateCsv } from './lib/csv-extractor.js';
import { generatePdfFromData } from './lib/pdf-from-data-generator.js';

// Initialize S3 client
const s3 = new S3Client({});

function sanitizeFilenameBase(name, fallback = 'Report') {
  const safe = String(name || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  return (safe || fallback).slice(0, 120);
}

function buildExportFilename(name, extension) {
  const base = sanitizeFilenameBase(name, 'Report');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${base}-${stamp}.${extension}`;
}

function asRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function sanitizeTagValue(value) {
  if (!value) return '';
  return String(value).replace(/[^a-zA-Z0-9\s+\-=._:/@]/g, '_');
}

function buildTaggingString(tags) {
  const sanitizedTags = {};
  for (const [key, value] of Object.entries(tags || {})) {
    if (value !== undefined && value !== null && value !== '') {
      if (key === 'recipients') {
        continue;
      }
      sanitizedTags[key] = sanitizeTagValue(value);
    }
  }
  return Object.entries(sanitizedTags)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join('&');
}

function appendHeaderLogoUrl(baseUrl, headerLogoUrl) {
  if (!headerLogoUrl) {
    return baseUrl;
  }
  try {
    const urlObj = new URL(baseUrl);
    urlObj.searchParams.set('headerLogoUrl', headerLogoUrl);
    return urlObj.toString();
  } catch {
    return baseUrl;
  }
}

async function generateArtifactBuffer({ format, targetUrl, options }) {
  if (format === 'csv') {
    const csvBuffer = await generateCsv(targetUrl, options);
    return {
      fileBuffer: csvBuffer,
      contentType: 'text/csv',
      fileExtension: 'csv',
      layoutApplied: null,
    };
  }

  const pdfBuffer = await generatePdf(targetUrl, options);
  return {
    fileBuffer: pdfBuffer,
    contentType: 'application/pdf',
    fileExtension: 'pdf',
    layoutApplied: pdfBuffer?.layoutApplied || null,
  };
}

async function uploadArtifactToS3({
  fileBuffer,
  contentType,
  fileExtension,
  reportTitle,
  scheduleId = null,
  leaseOwner = null,
  format = 'pdf',
  extraTags = {},
}) {
  const bucketName = process.env.S3_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('S3_BUCKET_NAME environment variable is not set');
  }

  const prefix = scheduleId ? 'emails' : 'pdfs';
  const outputFilename = buildExportFilename(reportTitle, fileExtension);
  const fileKey = `${prefix}/${outputFilename}`;

  const tags = scheduleId
    ? {
        scheduleId: scheduleId || 'unknown',
        leaseOwner: leaseOwner || '',
        format: format || fileExtension,
        ...extraTags,
      }
    : extraTags;
  const tagging = buildTaggingString(tags);

  const uploadParams = {
    Bucket: bucketName,
    Key: fileKey,
    Body: fileBuffer,
    ContentType: contentType,
    ACL: 'private',
  };

  if (tagging) {
    uploadParams.Tagging = tagging;
  }

  await s3.send(new PutObjectCommand(uploadParams));

  const presignedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      ResponseContentDisposition: `attachment; filename="${outputFilename}"`,
    }),
    { expiresIn: 60 * 60 }
  );

  return {
    bucketName,
    fileKey,
    outputFilename,
    presignedUrl,
    sizeBytes: Buffer.isBuffer(fileBuffer)
      ? fileBuffer.length
      : Buffer.byteLength(fileBuffer || ''),
  };
}

async function handleScheduledStepFunctionRequest(event) {
  const schedule = asRecord(event?.schedule);
  const attachment = asRecord(event?.attachment);
  const settings = asRecord(attachment.settings);
  const attachmentPdfOptions = asRecord(attachment.pdfOptions);
  const directReportParams = asRecord(event?.reportParams);
  const reportParams =
    Object.keys(directReportParams).length > 0
      ? directReportParams
      : asRecord(schedule?.reportParams);
  const directPdfExportPreferences = asRecord(event?.pdfExportPreferences);
  const pdfExportPreferences =
    Object.keys(directPdfExportPreferences).length > 0
      ? directPdfExportPreferences
      : asRecord(schedule?.pdfExportPreferences);
  const watermark = asRecord(pdfExportPreferences.watermark);
  const headerLogo = asRecord(pdfExportPreferences.headerLogo);

  const scheduleId =
    typeof event?.scheduleId === 'string'
      ? event.scheduleId
      : typeof schedule?.scheduleId === 'string'
        ? schedule.scheduleId
        : '';
  const leaseOwner =
    typeof event?.leaseOwner === 'string'
      ? event.leaseOwner
      : typeof schedule?.leaseOwner === 'string'
        ? schedule.leaseOwner
        : '';
  const baseUrl = typeof attachment.viewUrl === 'string' ? attachment.viewUrl : '';
  if (!scheduleId || !baseUrl) {
    throw new Error('scheduleId and attachment.viewUrl are required');
  }

  const format =
    typeof attachment.format === 'string' && attachment.format.trim().length > 0
      ? attachment.format.toLowerCase()
      : 'pdf';
  const reportTitle =
    typeof attachment.title === 'string' && attachment.title.trim().length > 0
      ? attachment.title
      : 'Report';
  const headerLogoUrl =
    headerLogo.enabled === true && typeof headerLogo.url === 'string'
      ? headerLogo.url
      : '';

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

  const targetUrl = appendHeaderLogoUrl(baseUrl, headerLogoUrl);
  const options = {
    isLambda: true,
    tableMode: false,
    pageSize:
      settings.pageSize ||
      attachmentPdfOptions?.pageSize ||
      reportParams?.pdfOptions?.pageSize ||
      'letter',
    orientation:
      settings.orientation ||
      attachmentPdfOptions?.orientation ||
      reportParams?.pdfOptions?.orientation ||
      'portrait',
    wideTableStrategy:
      settings.wideTableStrategy ||
      attachmentPdfOptions?.wideTableStrategy ||
      reportParams?.pdfOptions?.wideTableStrategy ||
      'auto',
    reportTitle,
    filterLine: '',
    timezone: event?.timezone || schedule?.timezone || 'UTC',
    debug: false,
    scheduleId,
    reportParams: lambdaReportParams,
    format,
    delimiter:
      settings.delimiter ||
      reportParams?.csvOptions?.delimiter ||
      ',',
    isVisualExport: targetUrl.includes('/visual/'),
    watermarkEnabled: watermark.enabled === true,
    watermarkText:
      watermark.enabled === true && typeof watermark.text === 'string'
        ? watermark.text
        : '',
    expandedState: null,
  };

  const { fileBuffer, contentType, fileExtension, layoutApplied } =
    await generateArtifactBuffer({
      format,
      targetUrl,
      options,
    });

  const uploaded = await uploadArtifactToS3({
    fileBuffer,
    contentType,
    fileExtension,
    reportTitle,
    scheduleId,
    leaseOwner,
    format,
    extraTags: {
      attachmentName: reportTitle,
    },
  });

  return {
    success: true,
    scheduleId,
    leaseOwner,
    s3Bucket: uploaded.bucketName,
    s3Key: uploaded.fileKey,
    attachmentName: reportTitle,
    format: fileExtension,
    contentType,
    sizeBytes: uploaded.sizeBytes,
    url: uploaded.presignedUrl,
    ...(layoutApplied ? { layoutApplied } : {}),
  };
}

/**
 * Handle data-direct POST requests (fast path)
 * Receives pre-organized table structure and generates PDF without URL rendering
 */
async function handleDataDirectRequest(event) {
  try {
    // Parse request body
    const payload = JSON.parse(event.body);
    console.log('Data-direct payload received:', {
      cardType: payload.cardType,
      reportTitle: payload.reportTitle,
      rows: payload.tableStructure?.rows?.length || 0,
    });

    // Validate payload
    if (!payload.cardType || !payload.tableStructure || !payload.reportTitle) {
      throw new Error('Missing required fields: cardType, tableStructure, reportTitle');
    }

    // Normalize defaults expected by generator
    payload.pageSize = payload.pageSize || 'Letter';
    payload.orientation = payload.orientation || 'portrait';
    payload.timezone = payload.timezone || 'UTC';
    payload.filterLine = payload.filterLine || '';
    payload.wideTableStrategy = payload.wideTableStrategy || 'auto';
    payload.rowCount =
      typeof payload.rowCount === 'number'
        ? payload.rowCount
        : payload.tableStructure?.rows?.length || 0;

    const options = {
      isLambda: true,
      wideTableStrategy: payload.wideTableStrategy,
    };

    console.log('Generating PDF from data with options:', options);

    // Generate PDF from data
    let pdfBuffer = await generatePdfFromData(payload, options);
    const layoutApplied = pdfBuffer?.layoutApplied || null;

    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error('Empty PDF buffer generated');
    }

    console.log('PDF generated successfully:', pdfBuffer.length, 'bytes');

    // Upload to S3
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('S3_BUCKET_NAME environment variable is not set');
    }

    const outputFilename = buildExportFilename(payload.reportTitle, 'pdf');
    const fileKey = `pdfs/${outputFilename}`;
    console.log('Uploading to S3:', fileKey);

    const uploadParams = {
      Bucket: bucketName,
      Key: fileKey,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      ACL: 'private',
    };

    await s3.send(new PutObjectCommand(uploadParams));
    console.log('PDF uploaded to S3:', `${bucketName}/${fileKey}`);

    // Generate presigned URL
    const presignedUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        ResponseContentDisposition: `attachment; filename="${outputFilename}"`,
      }),
      { expiresIn: 60 * 60 }
    );

    console.log('Returning presigned URL');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      },
      body: JSON.stringify({ url: presignedUrl, layoutApplied }),
    };
  } catch (error) {
    console.error('Data-direct PDF generation error:', error);
    return {
      statusCode: error.message?.includes('invalid') ? 400 : 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message || 'Internal server error',
        error: error.message,
      }),
    };
  }
}

export const handler = async (event) => {
  const isScheduleStepFnEvent =
    event?.source === 'schedule_stepfn' ||
    (typeof event?.scheduleId === 'string' &&
      event?.attachment &&
      !event?.queryStringParameters);
  try {
    if (isScheduleStepFnEvent) {
      return await handleScheduledStepFunctionRequest(event);
    }

    // Check if this is a data-direct POST request (fast path)
    // Lambda Function URLs use requestContext.http.method, not httpMethod
    const method = event.requestContext?.http?.method || event.httpMethod;

    console.log('Lambda invocation - Method:', method, 'Has body:', !!event.body);

    if (event.body && method === 'POST') {
      console.log('Detected data-direct POST request (fast path)');
      return await handleDataDirectRequest(event);
    }

    // Traditional URL-based request
    console.log('Using traditional URL-based PDF generation');

    // Extract parameters from query string
    const url = event?.queryStringParameters?.url;
    const email = event?.queryStringParameters?.email;
    const scheduleId = event?.queryStringParameters?.scheduleId;
    const leaseOwner = event?.queryStringParameters?.leaseOwner;
    const format = event?.queryStringParameters?.format || 'pdf';

    if (email && !scheduleId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:
            'Direct email query params are no longer supported by GeneratePdfFunction',
          error:
            'Use EmailSenderFunction direct action payload (send_consolidated) or semaphor-app /api/v1/pdf/email flow.',
        }),
      };
    }

    // Parse attachment metadata if provided
    let attachmentMetadata = {};
    const attachmentMetadataRaw =
      event?.queryStringParameters?.attachmentMetadata;
    if (attachmentMetadataRaw) {
      try {
        attachmentMetadata = JSON.parse(attachmentMetadataRaw);
        console.log('Parsed attachmentMetadata:', attachmentMetadata);
      } catch (e) {
        console.error('Error parsing attachmentMetadata:', e);
        attachmentMetadata = {};
      }
    }

    // Url
    console.log('Url:', url);

    // Parse reportParams if provided
    let reportParams = {};
    const reportParamsRaw = event?.queryStringParameters?.reportParams;
    console.log('Raw reportParams received:', reportParamsRaw);

    if (reportParamsRaw) {
      try {
        reportParams = JSON.parse(reportParamsRaw);
        console.log('Parsed reportParams successfully:', reportParams);
      } catch (e) {
        console.error('Error parsing reportParams:', e);
        console.error('Raw value was:', reportParamsRaw);
        reportParams = {};
      }
    } else {
      console.log('No reportParams provided in query parameters');
    }

    const tableMode = event?.queryStringParameters?.tableMode === 'true';
    const pdfMode =
      event?.queryStringParameters?.pdfMode || reportParams?.pdfMode || '';
    // Detect if this is a single visual export (URL contains /visual/) unless explicitly in table mode
    // Visual exports support pageSize and orientation settings
    const isVisualExport =
      url ? url.includes('/visual/') && !tableMode && pdfMode !== 'document' : false;

    // Parse watermark settings
    const watermarkEnabled =
      event?.queryStringParameters?.watermarkEnabled === 'true';
    const watermarkText = event?.queryStringParameters?.watermarkText || '';

    // Parse header logo URL (for visual-view.tsx rendering)
    const headerLogoUrl = event?.queryStringParameters?.headerLogoUrl || '';

    // Parse expanded state for custom components (if provided)
    const expandedState = event?.queryStringParameters?.expandedState || null;

    // Generation options
    const options = {
      isLambda: true,
      tableMode: tableMode,
      pdfMode: pdfMode,
      documentSheetId:
        event?.queryStringParameters?.documentSheetId ||
        reportParams?.documentSheetId,
      pageSize: event?.queryStringParameters?.pageSize || 'A4',
      orientation: event?.queryStringParameters?.orientation || 'portrait',
      wideTableStrategy: event?.queryStringParameters?.wideTableStrategy || 'auto',
      password: event?.queryStringParameters?.password,
      reportTitle:
        attachmentMetadata?.name ||
        event?.queryStringParameters?.reportTitle ||
        'Report',
      filterLine: event?.queryStringParameters?.filterLine || '',
      timezone: event?.queryStringParameters?.timezone || 'UTC',
      debug: false,
      scheduleId: scheduleId,
      reportParams: reportParams,
      format: format,
      delimiter: event?.queryStringParameters?.delimiter || ',',
      isVisualExport: isVisualExport,
      watermarkEnabled: watermarkEnabled,
      watermarkText: watermarkText,
      expandedState: expandedState,
    };

    console.log(
      'Lambda handler - Format:',
      format,
      'ScheduleId:',
      scheduleId || 'none',
      'IsVisualExport:',
      isVisualExport,
      'PdfMode:',
      pdfMode || 'default'
    );
    if (isVisualExport) {
      console.log('  Visual export - PageSize:', options.pageSize, 'Orientation:', options.orientation);
    }
    if (watermarkEnabled) {
      console.log('  Watermark enabled:', watermarkText);
    }
    if (headerLogoUrl) {
      console.log('  Header logo URL provided');
    }
    if (expandedState) {
      console.log('  Expanded state provided for custom components');
    }
    if (attachmentMetadata?.name) {
      console.log(
        'Processing attachment:',
        attachmentMetadata.name,
        `(${attachmentMetadata.attachmentIndex + 1}/${
          attachmentMetadata.totalAttachments
        })`
      );
    }

    // Append headerLogoUrl to view URL if provided (visual-view.tsx reads from searchParams)
    let targetUrl = url;
    if (headerLogoUrl) {
      try {
        const urlObj = new URL(url);
        urlObj.searchParams.set('headerLogoUrl', headerLogoUrl);
        targetUrl = urlObj.toString();
        console.log('  URL updated with headerLogoUrl');
      } catch (e) {
        console.error('Error adding headerLogoUrl to URL:', e);
      }
    }

    // Generate file based on format
    let fileBuffer;
    let contentType;
    let fileExtension;

    if (format === 'csv') {
      console.log('Generating CSV file');
      fileBuffer = await generateCsv(targetUrl, options);
      contentType = 'text/csv';
      fileExtension = 'csv';
    } else {
      console.log('Generating PDF file');
      fileBuffer = await generatePdf(targetUrl, options);
      contentType = 'application/pdf';
      fileExtension = 'pdf';
    }

    // Upload the PDF to S3
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('S3_BUCKET_NAME environment variable is not set');
    }

    // Determine S3 prefix based on whether this is a scheduled report
    let prefix = 'pdfs';
    let tags = {};

    if (scheduleId) {
      // For scheduled reports, use emails prefix and minimal tags
      prefix = 'emails';
      tags = {
        scheduleId: scheduleId || 'unknown',
        leaseOwner: leaseOwner || '',
        recipients: email || 'none',
        format: format || 'pdf',
        attachmentName: attachmentMetadata?.name || 'Report',
        attachmentIndex: String(attachmentMetadata?.attachmentIndex ?? 0),
        totalAttachments: String(attachmentMetadata?.totalAttachments ?? 1),
      };
    }

    const outputFilename = buildExportFilename(
      attachmentMetadata?.name || options.reportTitle || 'Report',
      fileExtension,
    );
    const fileKey = `${prefix}/${outputFilename}`;
    console.log('S3 upload:', fileKey, '- Format:', format);

    const tagging = buildTaggingString(tags);

    const uploadParams = {
      Bucket: bucketName,
      Key: fileKey,
      Body: fileBuffer,
      ContentType: contentType,
      ACL: 'private',
    };

    // Only add Tagging if we have valid tags
    if (tagging) {
      uploadParams.Tagging = tagging;
    }

    console.log(`Uploading ${fileExtension.toUpperCase()} to S3...`);
    await s3.send(new PutObjectCommand(uploadParams));
    console.log(
      `${fileExtension.toUpperCase()} uploaded to S3: ${bucketName}/${fileKey}`
    );

    // Generate presigned URL for download
    const presignedUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        ResponseContentDisposition: `attachment; filename="${outputFilename}"`,
      }),
      { expiresIn: 60 * 60 }
    );

    const layoutApplied = format === 'pdf' ? fileBuffer?.layoutApplied || null : null;

    console.log('Returning presigned URL.');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      },
      body: JSON.stringify({
        url: presignedUrl,
        s3Bucket: bucketName,
        s3Key: fileKey,
        attachmentName: attachmentMetadata?.name || options.reportTitle || 'Report',
        format: fileExtension,
        sizeBytes: Buffer.isBuffer(fileBuffer)
          ? fileBuffer.length
          : Buffer.byteLength(fileBuffer || ''),
        ...(layoutApplied ? { layoutApplied } : {}),
      }),
    };
  } catch (error) {
    if (isScheduleStepFnEvent) {
      throw error;
    }
    console.error('Lambda Handler Error:', error);
    return {
      statusCode: error.message?.includes('invalid') ? 400 : 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message || 'Internal server error',
        error: error.message,
      }),
    };
  }
};
