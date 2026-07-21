import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').split('// ---------- Navigation and event wiring ----------')[0];
const storage = new Map();
const context = vm.createContext({
  console,
  crypto: webcrypto,
  setTimeout,
  clearTimeout,
  confirm: () => true,
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key,value) => storage.set(key,value)
  },
  document: { getElementById: () => null }
  ,window: { VENUS_SUPABASE_CONFIG: { SUPABASE_URL:'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test' } }
});
vm.runInContext(appSource, context);

function run(source) {
  return vm.runInContext(source, context);
}

test('multiple additional charges and discounts calculate correctly', () => {
  const result = run(`(() => {
    state.feeAdjustments = [
      {studentId:'s1',monthKey:'2026-06',adjustmentType:'Additional Charge',amount:10,voided:false},
      {studentId:'s1',monthKey:'2026-06',adjustmentType:'Additional Charge',amount:5,voided:false},
      {studentId:'s1',monthKey:'2026-06',adjustmentType:'Discount',amount:3,voided:false},
      {studentId:'s1',monthKey:'2026-06',adjustmentType:'Discount',amount:50,voided:true}
    ];
    return feeBreakdown('s1','2026-06',80);
  })()`);
  assert.equal(result.additionalCharges, 15);
  assert.equal(result.discounts, 3);
  assert.equal(result.finalExpected, 92);
});

test('final expected amount never drops below zero', () => {
  const result = run(`(() => {
    state.feeAdjustments = [{studentId:'s1',monthKey:'2026-06',adjustmentType:'Discount',amount:120,voided:false}];
    return feeBreakdown('s1','2026-06',80).finalExpected;
  })()`);
  assert.equal(result, 0);
});

test('partial and multiple payments keep cumulative totals in each snapshot', () => {
  const result = run(`(() => {
    state = emptyData();
    state.students = [{id:'s1',studentName:'TEST STUDENT',form:'F3',parentPhone:'010-000 0000',joinDate:'2026-06-01',status:'Active',subjects:[{name:'Science',fee:80}]}];
    state.monthlyRecords['2026-06|s1'] = {studentId:'s1',monthKey:'2026-06',expectedFee:80,subjects:[{name:'Science',fee:80}],createdAt:new Date().toISOString()};
    state.feeAdjustments = [{id:'a1',studentId:'s1',monthKey:'2026-06',adjustmentType:'Additional Charge',description:'Printing Fee',amount:10,date:'2026-06-01',voided:false}];
    const first = {id:'p1',receiptNumber:'202606-001',studentId:'s1',paymentMonth:6,paymentYear:2026,paymentDate:'2026-06-06',amount:50,paymentMethod:'Cash',numberOfLessons:4,paymentDescription:'4 Lessons'};
    state.payments = [first];
    first.receiptSnapshot = buildReceiptSnapshot(first,getMonthRow('s1','2026-06'));
    const second = {id:'p2',receiptNumber:'202606-002',studentId:'s1',paymentMonth:6,paymentYear:2026,paymentDate:'2026-06-20',amount:40,paymentMethod:'Cash',numberOfLessons:4,paymentDescription:'4 Lessons'};
    state.payments.push(second);
    second.receiptSnapshot = buildReceiptSnapshot(second,getMonthRow('s1','2026-06'));
    return {first:first.receiptSnapshot,second:second.receiptSnapshot};
  })()`);
  assert.equal(result.first.amountPaidThisTime, 50);
  assert.equal(result.first.totalPaidToDate, 50);
  assert.equal(result.first.remainingBalance, 40);
  assert.equal(result.second.amountPaidThisTime, 40);
  assert.equal(result.second.totalPaidToDate, 90);
  assert.equal(result.second.remainingBalance, 0);
});

test('saved receipt snapshot stays unchanged after student and fee edits', () => {
  const result = run(`(() => {
    const payment = state.payments[0];
    const before = JSON.stringify(payment.receiptSnapshot);
    state.students[0].studentName = 'CHANGED NAME';
    state.monthlyRecords['2026-06|s1'].expectedFee = 200;
    return {before,after:JSON.stringify(payment.receiptSnapshot),markup:receiptMarkup(payment)};
  })()`);
  assert.equal(result.after, result.before);
  assert.match(result.markup, /TEST STUDENT/);
  assert.doesNotMatch(result.markup, /CHANGED NAME/);
});

test('receipt number is accepted only from the cloud RPC format', async () => {
  run(`currentWorkspaceId='workspace'; currentSession={user:{id:'owner'}}; sb={rpc:async()=>({data:'202605-003',error:null})};`);
  assert.equal(await run(`reserveReceiptNumber('2026-05-06')`), '202605-003');
  run(`sb={rpc:async()=>({data:'VE-202605-0003',error:null})};`);
  await assert.rejects(run(`reserveReceiptNumber('2026-05-06')`), /invalid receipt number/i);
});
