import { normalizePageSize } from '../page-size-utils.js';

export async function waitForDocumentReady(page, timeout = 90000) {
  console.log('Document mode - waiting for print surface readiness');
  const waitStart = Date.now();
  await page.emulateMediaType('print');
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      })
  );

  const readiness = await page.evaluate(async (maxWait) => {
    const start = Date.now();
    let lastReason = 'Document did not become ready';
    let lastDiagnostics = {};

    while (Date.now() - start < maxWait) {
      const hasDocumentPages = document.querySelector(
        '[data-document-page-stack="true"] [data-testid="document-page"]'
      );
      const semaphorReady = window.__SEMAPHOR_READY__?.ready === true;
      const hasRenderError = Boolean(
        document.querySelector('[data-document-render-error="true"]')
      );
      const hasRenderLoadingState = Boolean(
        document.querySelector('[data-document-render-loading="true"]')
      );
      const hasLoadingText = /loading table|generating document/i.test(
        document.body.innerText || ''
      );
      const diagnostics = {
        url: window.location.href,
        title: document.title || '',
        bodyText: (document.body.innerText || '').trim().slice(0, 500),
        hasDocumentPrintRoot: Boolean(
          document.querySelector('[data-document-print-root="true"]')
        ),
        hasDocumentPageStack: Boolean(
          document.querySelector('[data-document-page-stack="true"]')
        ),
        renderLoadingElements: Array.from(
          document.querySelectorAll('[data-document-render-loading="true"]')
        ).map((element) => ({
          tagName: element.tagName,
          testId: element.getAttribute('data-testid') || '',
          tableSection:
            element.getAttribute('data-document-table-section') || '',
          text: (element.textContent || '').trim().slice(0, 160),
        })).slice(0, 5),
      };
      lastDiagnostics = diagnostics;

      if (hasRenderError) {
        lastReason = 'Document render contained blocking section errors';
      } else if (!hasDocumentPages) {
        lastReason = 'Document page stack was not mounted';
      } else if (hasRenderLoadingState) {
        lastReason = 'Document still showed loading content';
      } else if (hasLoadingText) {
        lastReason = 'Document still showed loading content';
      } else if (!semaphorReady) {
        lastReason = 'Semaphor readiness indicator did not complete';
      } else {
        return { ready: true };
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    return { ready: false, reason: lastReason, diagnostics: lastDiagnostics };
  }, timeout);

  if (!readiness.ready) {
    const diagnostics = readiness.diagnostics
      ? ` (${JSON.stringify(readiness.diagnostics)})`
      : '';
    throw new Error(
      `Document render did not become ready: ${readiness.reason}${diagnostics}`
    );
  }
  console.log(`⏱️  Document surface ready: ${Date.now() - waitStart}ms`);

  const assetsStart = Date.now();
  const assetsReady = await page.evaluate(async (maxWait) => {
    const withTimeout = (promise, reason) =>
      Promise.race([
        promise.then(() => ({ ready: true })),
        new Promise((resolve) =>
          setTimeout(() => resolve({ ready: false, reason }), maxWait)
        ),
      ]);

    if (document.fonts?.ready) {
      const fontResult = await withTimeout(
        document.fonts.ready,
        'Timed out waiting for document fonts'
      );
      if (!fontResult.ready) {
        return fontResult;
      }
    }

    const images = Array.from(document.images || []);
    const imageResult = await withTimeout(
      Promise.all(
        images.map((img) => {
          if (img.complete) {
            return Promise.resolve();
          }
          return new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          });
        })
      ),
      'Timed out waiting for document images'
    );

    return imageResult;
  }, timeout);

  if (!assetsReady.ready) {
    throw new Error(`Document assets did not become ready: ${assetsReady.reason}`);
  }
  console.log(`⏱️  Document assets ready: ${Date.now() - assetsStart}ms`);

  const layoutStart = Date.now();
  await assertDocumentPagesFit(page);
  console.log(`⏱️  Document layout validation: ${Date.now() - layoutStart}ms`);
  console.log(`⏱️  Document readiness total: ${Date.now() - waitStart}ms`);
}

async function assertDocumentPagesFit(page) {
  const pageLayout = await page.evaluate(() => {
    const pages = Array.from(
      document.querySelectorAll('[data-testid="document-page"]')
    );
    const overflowingPage = pages.find((pageElement) => {
      const element = pageElement;
      const overflowY = element.scrollHeight - element.clientHeight;
      const overflowX = element.scrollWidth - element.clientWidth;

      return overflowY > 2 || overflowX > 2;
    });

    if (!overflowingPage) {
      return { ready: true };
    }

    const pageIndex = pages.indexOf(overflowingPage) + 1;
    return {
      ready: false,
      reason: `Generated document page ${pageIndex} overflowed its fixed page box`,
    };
  });

  if (!pageLayout.ready) {
    throw new Error(`Document layout was not print-safe: ${pageLayout.reason}`);
  }
}

export async function preparePage(page) {
  console.log('Document mode - preparing fixed-layout print surface');
  const prepareStart = Date.now();

  await page.emulateMediaType('print');
  await page.evaluate(() => {
    document.documentElement.style.background = '#fff';
    document.body.style.background = '#fff';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.documentElement.style.overflow = 'visible';
    document.documentElement.style.height = 'auto';
    document.body.style.overflow = 'visible';
    document.body.style.height = 'auto';

    const pageStack = document.querySelector('[data-document-page-stack="true"]');
    if (pageStack) {
      pageStack.style.overflow = 'visible';
      pageStack.style.height = 'auto';
      pageStack.style.maxHeight = 'none';

      let ancestor = pageStack.parentElement;
      while (ancestor && ancestor !== document.body) {
        ancestor.style.overflow = 'visible';
        ancestor.style.height = 'auto';
        ancestor.style.maxHeight = 'none';
        ancestor = ancestor.parentElement;
      }
    }

    const idleCheck = document.getElementById('idle-check');
    if (idleCheck) {
      idleCheck.style.visibility = 'hidden';
      idleCheck.style.display = 'none';
      idleCheck.setAttribute('aria-hidden', 'true');
      idleCheck.textContent = '';
    }
  });

  await assertDocumentPagesFit(page);
  console.log(`⏱️  Document print preparation: ${Date.now() - prepareStart}ms`);
}

export function getPdfOptions(_dimensions, pageSize = 'Letter', options = {}) {
  console.log('Document mode - using CSS page size');
  console.log('  Page size:', pageSize);
  console.log('  Orientation:', options.orientation || 'portrait');

  return {
    format: normalizePageSize(pageSize),
    landscape: options.orientation === 'landscape',
    printBackground: true,
    margin: {
      top: '0',
      right: '0',
      bottom: '0',
      left: '0',
    },
    displayHeaderFooter: false,
    preferCSSPageSize: true,
    scale: 1,
    timeout: 60000,
  };
}
