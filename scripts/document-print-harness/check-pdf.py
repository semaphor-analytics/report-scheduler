"""Reads a Document print PDF back and checks it is complete.

Usage: python3 check-pdf.py <pdf> <expected rows> [--last-column NOTES]

Checks, and prints one JSON line:
- every synthetic row id R00001..Rnnnnn appears exactly once, in order;
- every page carries one "Page N of M", with N its own number and M the page count;
- every page that prints rows carries the last visible column's header (headers
  print upper case; a narrow unwrapped header may truncate, so only the last
  column's label is required), so no column was clipped;
- the hidden sort keys never print.

Text is compared with whitespace removed, since a wrapped cell can break a row
id across lines. Needs pypdf (pip install pypdf).
"""

import argparse
import json
import re

from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument('pdf')
parser.add_argument('expected_rows', type=int)
parser.add_argument('--last-column', default='NOTES')
args = parser.parse_args()

reader = PdfReader(args.pdf)
page_count = len(reader.pages)
row_ids = []
label_problems = []
pages_without_last_column = []
hidden_key_pages = []
labels_seen = []
for index, page in enumerate(reader.pages):
    text = page.extract_text() or ''
    flat = re.sub(r'\s+', ' ', text)
    labels = re.findall(r'Page (\d+) of (\d+)', flat)
    labels_seen.append(labels[:1])
    if labels != [(str(index + 1), str(page_count))]:
        label_problems.append({'page': index + 1, 'labels': labels[:3]})
    compact = re.sub(r'\s+', '', text)
    ids = re.findall(r'R(\d{5})(?!\d)', compact)
    row_ids.extend(int(value) for value in ids)
    upper = compact.upper()
    if ids and args.last_column not in upper:
        pages_without_last_column.append(index + 1)
    if 'SORT_KEY' in upper or 'GROUP_KEY' in upper:
        hidden_key_pages.append(index + 1)

expected = list(range(1, args.expected_rows + 1))
missing = sorted(set(expected) - set(row_ids))
result = {
    'pages': page_count,
    'rowIds': len(row_ids),
    'complete': row_ids == expected,
    'missing': len(missing),
    'firstMissing': missing[:5],
    'duplicates': len(row_ids) - len(set(row_ids)),
    'inOrder': row_ids == sorted(row_ids),
    'labelProblems': len(label_problems),
    'firstLabelProblems': label_problems[:3],
    'pagesWithoutLastColumn': len(pages_without_last_column),
    'firstPagesWithoutLastColumn': pages_without_last_column[:5],
    'hiddenKeyPages': hidden_key_pages[:5],
    'labels': {
        'first': ' of '.join(labels_seen[0][0]) if labels_seen and labels_seen[0] else None,
        'middle': ' of '.join(labels_seen[page_count // 2][0]) if page_count and labels_seen[page_count // 2] else None,
        'last': ' of '.join(labels_seen[-1][0]) if labels_seen and labels_seen[-1] else None,
    },
}
result['ok'] = (
    result['complete']
    and result['labelProblems'] == 0
    and result['pagesWithoutLastColumn'] == 0
    and not result['hiddenKeyPages']
)
print(json.dumps(result))
