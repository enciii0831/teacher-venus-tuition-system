import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [css, html, app] = await Promise.all([
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8')
]);

test('receipt preview is a dedicated vertical scroll region without horizontal overflow', () => {
  assert.match(css, /#receiptModal \.receipt-modal-scroll\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;/s);
  assert.match(html, /class="modal-body receipt-modal-scroll" tabindex="0"/);
});

test('form modals keep their footer visible and scroll only the body', () => {
  assert.match(css, /\.modal > form\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*display:\s*flex;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.modal > form > \.modal-body\s*\{[^}]*flex:\s*1 1 auto;/s);
  assert.match(css, /\.modal-body\s*\{[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;/s);
});

test('payment summary cards wrap instead of creating a horizontal scrollbar', () => {
  assert.match(css, /\.adjustment-summary\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,minmax\(130px,1fr\)\);[^}]*min-width:\s*0;/s);
  assert.doesNotMatch(css, /grid-template-columns:\s*repeat\(6,minmax\(120px,1fr\)\)/);
});

test('narrow screens do not force an oversized receipt', () => {
  assert.doesNotMatch(css, /\.receipt\s*\{[^}]*min-width:\s*850px/s);
  assert.match(css, /@media \(max-width: 500px\)[\s\S]*?\.receipt\s*\{[^}]*min-width:\s*0;/);
  assert.match(css, /@media \(max-width: 500px\)[\s\S]*?\.receipt-main-grid\s*\{[^}]*grid-template-columns:\s*1fr;/);
});

test('opening a receipt resets its preview to the top-left', () => {
  assert.match(app, /if \(id === 'receiptModal'\)[\s\S]*?scrollArea\.scrollTop = 0;[\s\S]*?scrollArea\.scrollLeft = 0;/);
});
