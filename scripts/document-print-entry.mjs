// The Document print contract (react-semaphor format-utils `document-print`,
// Document PDF reliability C1 to C4), bundled for the PDF renderer like the
// table layout engine: the codes, the facts and layout parsers, the internal
// description and the one page-fit tolerance. The worker imports them only
// from this adapter.
export {
  DOCUMENT_PAGE_FIT_TOLERANCE_PX,
  DOCUMENT_PRINT_FAILURE_CODES,
  describeDocumentPrintFailure,
  isDocumentPrintFailureCode,
  readDocumentPrintFailureFacts,
  readDocumentPrintLayout,
} from 'react-semaphor/format-utils';
