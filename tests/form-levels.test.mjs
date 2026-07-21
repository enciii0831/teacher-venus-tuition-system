import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, app, migration] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/202607210002_add_year_levels.sql', import.meta.url), 'utf8')
]);

const yearLevels = ['Y1','Y2','Y3','Y4','Y5','Y6'];

test('student filters and form selectors include Y1 through Y6', () => {
  for (const level of yearLevels) {
    assert.match(html, new RegExp(`data-form-filter="${level}"`));
    assert.match(html, new RegExp(`<option>${level}</option>`));
    assert.match(app, new RegExp(`'${level}'`));
  }
});

test('Supabase constraints allow all Year and Form levels', () => {
  for (const level of [...yearLevels, 'F1','F2','F3','F4','F5']) {
    assert.match(migration, new RegExp(`'${level}'`));
  }
  assert.match(migration, /alter table public\.students[\s\S]*add constraint students_form_check/);
  assert.match(migration, /alter table public\.classes[\s\S]*add constraint classes_form_check/);
});
