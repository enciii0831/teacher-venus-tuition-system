-- Teacher VENUS Tuition Fee Management System
-- Fee adjustments, immutable receipt snapshots and concurrency-safe receipt numbers.

alter table public.payments
  add column if not exists bank_name text not null default '',
  add column if not exists reference_number text not null default '',
  add column if not exists transfer_date date,
  add column if not exists number_of_lessons integer check (number_of_lessons is null or number_of_lessons > 0),
  add column if not exists payment_description text not null default '',
  add column if not exists receipt_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id);

create table if not exists public.fee_adjustments (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  student_id text not null,
  month_key text not null check (month_key ~ '^\d{4}-\d{2}$'),
  adjustment_type text not null check (adjustment_type in ('Additional Charge','Discount')),
  description text not null check (length(trim(description)) > 0),
  amount numeric(12,2) not null check (amount > 0),
  adjustment_date date not null,
  notes text not null default '',
  voided boolean not null default false,
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz,
  updated_by uuid references auth.users(id),
  primary key (workspace_id, id),
  foreign key (workspace_id, student_id) references public.students(workspace_id, id) on delete cascade
);

create index if not exists idx_fee_adjustments_workspace_month
  on public.fee_adjustments(workspace_id, month_key, student_id);

create table if not exists public.receipt_sequences (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  month_key text not null check (month_key ~ '^\d{6}$'),
  last_number integer not null check (last_number > 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, month_key)
);

alter table public.fee_adjustments enable row level security;
alter table public.receipt_sequences enable row level security;

drop policy if exists fee_adjustments_select_manage on public.fee_adjustments;
create policy fee_adjustments_select_manage on public.fee_adjustments for select to authenticated
using (private.can_manage_workspace_data(workspace_id));
drop policy if exists fee_adjustments_insert_manage on public.fee_adjustments;
create policy fee_adjustments_insert_manage on public.fee_adjustments for insert to authenticated
with check (private.can_manage_workspace_data(workspace_id));
drop policy if exists fee_adjustments_update_manage on public.fee_adjustments;
create policy fee_adjustments_update_manage on public.fee_adjustments for update to authenticated
using (private.can_manage_workspace_data(workspace_id))
with check (private.can_manage_workspace_data(workspace_id));
drop policy if exists fee_adjustments_delete_manage on public.fee_adjustments;
create policy fee_adjustments_delete_manage on public.fee_adjustments for delete to authenticated
using (private.can_manage_workspace_data(workspace_id));

revoke all on public.fee_adjustments from anon, public;
grant select, insert, update, delete on public.fee_adjustments to authenticated;
revoke all on public.receipt_sequences from anon, authenticated;

create or replace function public.reserve_receipt_number(
  p_workspace_id uuid,
  p_payment_date date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_key text;
  v_initial integer;
  v_number integer;
begin
  if (select auth.uid()) is null or not private.can_manage_workspace_data(p_workspace_id) then
    raise exception 'Not authorized for this workspace.';
  end if;
  if p_payment_date is null then
    raise exception 'Payment date is required.';
  end if;

  v_month_key := to_char(p_payment_date, 'YYYYMM');
  select coalesce(max((substring(receipt_number from '^\d{6}-(\d+)$'))::integer), 0) + 1
    into v_initial
  from public.payments
  where workspace_id = p_workspace_id
    and receipt_number ~ ('^' || v_month_key || '-\d+$');

  insert into public.receipt_sequences(workspace_id, month_key, last_number, updated_at)
  values (p_workspace_id, v_month_key, v_initial, now())
  on conflict (workspace_id, month_key) do update
    set last_number = public.receipt_sequences.last_number + 1,
        updated_at = now()
  returning last_number into v_number;

  return v_month_key || '-' || lpad(v_number::text, 3, '0');
end;
$$;

revoke all on function public.reserve_receipt_number(uuid,date) from public, anon;
grant execute on function public.reserve_receipt_number(uuid,date) to authenticated;

create or replace function public.get_workspace_state(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare result jsonb;
begin
  if not private.can_manage_workspace_data(p_workspace_id) then
    raise exception 'Not authorized for this workspace.';
  end if;
  select jsonb_build_object(
    'version', 3,
    'dataVersion', w.data_version,
    'settings', w.settings,
    'students', coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'studentName',s.student_name,'form',coalesce(s.form,''),'parentName',s.parent_name,
      'parentPhone',s.parent_phone,'joinDate',s.join_date,'status',s.status,'subjects',s.subjects,
      'monthlyFee',s.monthly_fee,'notes',s.notes,'createdAt',s.created_at,'updatedAt',s.updated_at
    ) order by s.student_name) from public.students s where s.workspace_id=w.id),'[]'::jsonb),
    'classes', coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'className',c.class_name,'form',c.form,'subject',c.subject,'day',c.day,
      'startTime',to_char(c.start_time,'HH24:MI'),'endTime',to_char(c.end_time,'HH24:MI'),
      'monthlyFee',c.monthly_fee,'studentIds',to_jsonb(c.student_ids),'status',c.status,'notes',c.notes,
      'createdAt',c.created_at,'updatedAt',c.updated_at
    ) order by c.day,c.start_time) from public.classes c where c.workspace_id=w.id),'[]'::jsonb),
    'monthlyRecords', coalesce((select jsonb_object_agg(m.month_key||'|'||m.student_id,jsonb_build_object(
      'studentId',m.student_id,'monthKey',m.month_key,'expectedFee',m.expected_fee,'subjects',m.subjects,
      'createdAt',m.created_at,'updatedAt',m.updated_at
    )) from public.monthly_records m where m.workspace_id=w.id),'{}'::jsonb),
    'feeAdjustments', coalesce((select jsonb_agg(jsonb_build_object(
      'id',f.id,'studentId',f.student_id,'monthKey',f.month_key,'adjustmentType',f.adjustment_type,
      'description',f.description,'amount',f.amount,'date',f.adjustment_date,'notes',f.notes,
      'voided',f.voided,'voidedAt',f.voided_at,'voidedBy',f.voided_by,
      'createdAt',f.created_at,'createdBy',f.created_by,'updatedAt',f.updated_at,'updatedBy',f.updated_by
    ) order by f.adjustment_date,f.created_at) from public.fee_adjustments f where f.workspace_id=w.id),'[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'receiptNumber',p.receipt_number,'studentId',p.student_id,'paymentMonth',p.payment_month,
      'paymentYear',p.payment_year,'paymentDate',p.payment_date,'amount',p.amount,'paymentMethod',p.payment_method,
      'bankName',p.bank_name,'referenceNumber',p.reference_number,'transferDate',p.transfer_date,
      'numberOfLessons',p.number_of_lessons,'paymentDescription',p.payment_description,
      'receiptSnapshot',p.receipt_snapshot,'notes',p.notes,'voided',p.voided,'voidedAt',p.voided_at,
      'voidedBy',p.voided_by,'createdAt',p.created_at,'createdBy',p.created_by,
      'updatedAt',p.updated_at,'updatedBy',p.updated_by
    ) order by p.payment_date,p.created_at) from public.payments p where p.workspace_id=w.id),'[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'studentId',a.student_id,'classId',a.class_id,'attendanceDate',a.attendance_date,
      'status',a.status,'reason',a.reason,'notes',a.notes,'recordedAt',a.recorded_at
    ) order by a.attendance_date,a.recorded_at) from public.attendance a where a.workspace_id=w.id),'[]'::jsonb),
    'receiptCounters', w.receipt_counters,
    'updatedAt', w.updated_at
  ) into result from public.workspaces w where w.id=p_workspace_id;
  return coalesce(result,'{}'::jsonb);
end;
$$;

create or replace function public.sync_workspace_state(
  p_workspace_id uuid,
  p_state jsonb,
  p_expected_version bigint,
  p_action text default null,
  p_record_label text default ''
)
returns bigint language plpgsql security definer set search_path = public
as $$
declare current_version bigint;
declare next_version bigint;
declare actor_role text;
declare actor_email text;
begin
  if not private.can_manage_workspace_data(p_workspace_id) then
    raise exception 'Not authorized for this workspace.';
  end if;
  select data_version into current_version from public.workspaces where id=p_workspace_id for update;
  if current_version is null then raise exception 'Workspace not found.'; end if;
  if current_version <> coalesce(p_expected_version,0) then
    raise exception 'Workspace data changed on another device. Reload and try again.' using errcode='40001';
  end if;

  delete from public.attendance where workspace_id=p_workspace_id;
  delete from public.fee_adjustments where workspace_id=p_workspace_id;
  delete from public.payments where workspace_id=p_workspace_id;
  delete from public.monthly_records where workspace_id=p_workspace_id;
  delete from public.classes where workspace_id=p_workspace_id;
  delete from public.students where workspace_id=p_workspace_id;

  insert into public.students(workspace_id,id,student_name,form,parent_name,parent_phone,join_date,status,subjects,monthly_fee,notes,created_at,updated_at)
  select p_workspace_id,x.id,x."studentName",nullif(x.form,''),coalesce(x."parentName",''),x."parentPhone",
    x."joinDate"::date,x.status,coalesce(x.subjects,'[]'::jsonb),coalesce(x."monthlyFee",0),coalesce(x.notes,''),
    coalesce(nullif(x."createdAt",'')::timestamptz,now()),nullif(x."updatedAt",'')::timestamptz
  from jsonb_to_recordset(coalesce(p_state->'students','[]'::jsonb)) as x(
    id text,"studentName" text,form text,"parentName" text,"parentPhone" text,"joinDate" text,status text,
    subjects jsonb,"monthlyFee" numeric,notes text,"createdAt" text,"updatedAt" text
  );

  insert into public.classes(workspace_id,id,class_name,form,subject,day,start_time,end_time,monthly_fee,student_ids,status,notes,created_at,updated_at)
  select p_workspace_id,x.id,x."className",x.form,x.subject,x.day,x."startTime"::time,x."endTime"::time,
    coalesce(x."monthlyFee",0),array(select jsonb_array_elements_text(coalesce(x."studentIds",'[]'::jsonb))),
    x.status,coalesce(x.notes,''),coalesce(nullif(x."createdAt",'')::timestamptz,now()),nullif(x."updatedAt",'')::timestamptz
  from jsonb_to_recordset(coalesce(p_state->'classes','[]'::jsonb)) as x(
    id text,"className" text,form text,subject text,day text,"startTime" text,"endTime" text,
    "monthlyFee" numeric,"studentIds" jsonb,status text,notes text,"createdAt" text,"updatedAt" text
  );

  insert into public.monthly_records(workspace_id,student_id,month_key,expected_fee,subjects,created_at,updated_at)
  select p_workspace_id,v->>'studentId',v->>'monthKey',coalesce((v->>'expectedFee')::numeric,0),
    coalesce(v->'subjects','[]'::jsonb),coalesce(nullif(v->>'createdAt','')::timestamptz,now()),nullif(v->>'updatedAt','')::timestamptz
  from jsonb_each(coalesce(p_state->'monthlyRecords','{}'::jsonb)) as e(k,v);

  insert into public.payments(
    workspace_id,id,receipt_number,student_id,payment_month,payment_year,payment_date,amount,payment_method,
    bank_name,reference_number,transfer_date,number_of_lessons,payment_description,receipt_snapshot,notes,
    voided,voided_at,voided_by,created_at,created_by,updated_at,updated_by
  )
  select p_workspace_id,x.id,x."receiptNumber",x."studentId",x."paymentMonth",x."paymentYear",x."paymentDate"::date,
    x.amount,x."paymentMethod",coalesce(x."bankName",''),coalesce(x."referenceNumber",''),nullif(x."transferDate",'')::date,
    x."numberOfLessons",coalesce(x."paymentDescription",''),coalesce(x."receiptSnapshot",'{}'::jsonb),coalesce(x.notes,''),
    coalesce(x.voided,false),nullif(x."voidedAt",'')::timestamptz,nullif(x."voidedBy",'')::uuid,
    coalesce(nullif(x."createdAt",'')::timestamptz,now()),nullif(x."createdBy",'')::uuid,
    nullif(x."updatedAt",'')::timestamptz,nullif(x."updatedBy",'')::uuid
  from jsonb_to_recordset(coalesce(p_state->'payments','[]'::jsonb)) as x(
    id text,"receiptNumber" text,"studentId" text,"paymentMonth" integer,"paymentYear" integer,
    "paymentDate" text,amount numeric,"paymentMethod" text,"bankName" text,"referenceNumber" text,
    "transferDate" text,"numberOfLessons" integer,"paymentDescription" text,"receiptSnapshot" jsonb,notes text,
    voided boolean,"voidedAt" text,"voidedBy" text,"createdAt" text,"createdBy" text,"updatedAt" text,"updatedBy" text
  );

  insert into public.fee_adjustments(
    workspace_id,id,student_id,month_key,adjustment_type,description,amount,adjustment_date,notes,
    voided,voided_at,voided_by,created_at,created_by,updated_at,updated_by
  )
  select p_workspace_id,x.id,x."studentId",x."monthKey",x."adjustmentType",x.description,x.amount,x.date::date,
    coalesce(x.notes,''),coalesce(x.voided,false),nullif(x."voidedAt",'')::timestamptz,nullif(x."voidedBy",'')::uuid,
    coalesce(nullif(x."createdAt",'')::timestamptz,now()),nullif(x."createdBy",'')::uuid,
    nullif(x."updatedAt",'')::timestamptz,nullif(x."updatedBy",'')::uuid
  from jsonb_to_recordset(coalesce(p_state->'feeAdjustments','[]'::jsonb)) as x(
    id text,"studentId" text,"monthKey" text,"adjustmentType" text,description text,amount numeric,date text,notes text,
    voided boolean,"voidedAt" text,"voidedBy" text,"createdAt" text,"createdBy" text,"updatedAt" text,"updatedBy" text
  );

  insert into public.attendance(workspace_id,id,student_id,class_id,attendance_date,status,reason,notes,recorded_at)
  select p_workspace_id,x.id,x."studentId",x."classId",x."attendanceDate"::date,x.status,
    coalesce(x.reason,''),coalesce(x.notes,''),coalesce(nullif(x."recordedAt",'')::timestamptz,now())
  from jsonb_to_recordset(coalesce(p_state->'attendance','[]'::jsonb)) as x(
    id text,"studentId" text,"classId" text,"attendanceDate" text,status text,reason text,notes text,"recordedAt" text
  );

  next_version := current_version + 1;
  update public.workspaces
    set settings=coalesce(p_state->'settings','{}'::jsonb),
        receipt_counters=coalesce(p_state->'receiptCounters','{}'::jsonb),
        data_version=next_version,updated_at=now()
    where id=p_workspace_id;

  if nullif(trim(coalesce(p_action,'')),'') is not null then
    select wm.role,p.email into actor_role,actor_email
    from public.workspace_members wm join public.profiles p on p.user_id=wm.user_id
    where wm.workspace_id=p_workspace_id and wm.user_id=(select auth.uid());
    insert into public.audit_logs(workspace_id,user_id,user_email,user_role,action,record_label)
    values (p_workspace_id,(select auth.uid()),coalesce(actor_email,''),actor_role,p_action,coalesce(p_record_label,''));
  end if;
  return next_version;
end;
$$;

revoke all on function public.get_workspace_state(uuid) from public, anon;
revoke all on function public.sync_workspace_state(uuid,jsonb,bigint,text,text) from public, anon;
grant execute on function public.get_workspace_state(uuid) to authenticated;
grant execute on function public.sync_workspace_state(uuid,jsonb,bigint,text,text) to authenticated;
