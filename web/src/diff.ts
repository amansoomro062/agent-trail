/**
 * diff.ts - small line-based diff for Edit/MultiEdit tool calls.
 *
 * Classic LCS over lines, with the common prefix and suffix trimmed first so
 * the O(m*n) matrix only covers the changed middle. That is enough for the
 * old_string/new_string pairs these tool calls carry, usually tens of lines.
 * Inputs too large for the matrix fall back to remove-all then add-all.
 */

export type DiffLineKind = 'context' | 'del' | 'add';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/** A collapsed run of unchanged lines, expandable in the UI. */
export interface CollapsedRun {
  kind: 'collapsed';
  lines: DiffLine[];
}

export type DiffRow = DiffLine | CollapsedRun;

/** Safety bound on the LCS matrix size, in cells. */
const MAX_MATRIX_CELLS = 1_000_000;

/** Line-based diff of two strings: context, removed and added lines in order. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');

  // trim the shared prefix and suffix
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const m = endA - start;
  const n = endB - start;
  const mid: DiffLine[] = [];

  if (m > 0 && n > 0 && m * n <= MAX_MATRIX_CELLS) {
    // dp[i][j] = LCS length of a[start+i..endA) and b[start+j..endB)
    const stride = n + 1;
    const dp = new Uint32Array((m + 1) * stride);
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i * stride + j] =
          a[start + i] === b[start + j]
            ? dp[(i + 1) * stride + j + 1] + 1
            : Math.max(dp[(i + 1) * stride + j], dp[i * stride + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (a[start + i] === b[start + j]) {
        mid.push({ kind: 'context', text: a[start + i] });
        i++;
        j++;
      } else if (dp[(i + 1) * stride + j] >= dp[i * stride + j + 1]) {
        mid.push({ kind: 'del', text: a[start + i] });
        i++;
      } else {
        mid.push({ kind: 'add', text: b[start + j] });
        j++;
      }
    }
    while (i < m) mid.push({ kind: 'del', text: a[start + i++] });
    while (j < n) mid.push({ kind: 'add', text: b[start + j++] });
  } else {
    // empty side or too big for the matrix: remove-all then add-all
    for (let i = start; i < endA; i++) mid.push({ kind: 'del', text: a[i] });
    for (let j = start; j < endB; j++) mid.push({ kind: 'add', text: b[j] });
  }

  const toContext = (text: string): DiffLine => ({ kind: 'context', text });
  return [...a.slice(0, start).map(toContext), ...mid, ...a.slice(endA).map(toContext)];
}

/**
 * Collapse long runs of unchanged lines, keeping `keep` context lines next
 * to each change. Runs at the edges only keep context on the side facing a
 * change. Collapsed runs stay in the output so the UI can expand them.
 */
export function collapseContext(lines: DiffLine[], keep = 3): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== 'context') {
      rows.push(lines[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].kind === 'context') j++;
    const head = i === 0 ? 0 : keep;
    const tail = j === lines.length ? 0 : keep;
    if (j - i <= head + tail + 1) {
      for (let k = i; k < j; k++) rows.push(lines[k]);
    } else {
      for (let k = 0; k < head; k++) rows.push(lines[i + k]);
      rows.push({ kind: 'collapsed', lines: lines.slice(i + head, j - tail) });
      for (let k = tail; k > 0; k--) rows.push(lines[j - k]);
    }
    i = j;
  }
  return rows;
}
