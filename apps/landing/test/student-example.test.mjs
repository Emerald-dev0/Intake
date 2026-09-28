import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/lib/planner.ts';

test('the browser demo makes the student example intelligible without a provider connection', () => {
  const preview = plan('Create a registration form for my final-year project. Ask for full name, email, department (Science, Arts, Engineering), level, phone number, and whether they need accommodation. If they select yes, ask what type of accommodation they need.');
  const fields = preview.spec.fields;
  assert.match(preview.spec.title, /Final-year Project/);
  for (const id of ['full_name', 'email_address', 'department', 'level', 'phone_number', 'need_accommodation', 'type_accommodation_need']) {
    assert.ok(fields.some(field => field.id === id), `missing ${id}`);
  }
  assert.deepEqual(fields.find(field => field.id === 'department')?.options, ['Science', 'Arts', 'Engineering']);
  assert.deepEqual(fields.find(field => field.id === 'type_accommodation_need')?.when, {
    field: 'need_accommodation', op: 'eq', value: 'Yes',
  });
});
