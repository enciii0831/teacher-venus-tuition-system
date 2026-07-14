-- Teacher VENUS Tuition Fee Management System
-- Run once in Supabase SQL Editor. Safe to re-run for the seeded workspace.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid references auth.users(id) on delete restrict,
  receipt_counters jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  data_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('owner','co_owner')),
  status text not null default 'active' check (status in ('active','inactive')),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null check (role in ('owner','co_owner')),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email)
);

create table if not exists public.students (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  student_name text not null,
  form text,
  parent_name text not null default '',
  parent_phone text not null,
  join_date date not null,
  status text not null check (status in ('Active','Inactive','Stopped')),
  subjects jsonb not null default '[]'::jsonb,
  monthly_fee numeric(12,2) not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (workspace_id, id)
);

create table if not exists public.classes (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  class_name text not null,
  form text not null check (form in ('F1','F2','F3','F4','F5')),
  subject text not null,
  day text not null check (day in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  start_time time not null,
  end_time time not null,
  monthly_fee numeric(12,2) not null default 0,
  student_ids text[] not null default '{}',
  status text not null check (status in ('Active','Inactive')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (workspace_id, id),
  check (end_time > start_time)
);

create table if not exists public.monthly_records (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  student_id text not null,
  month_key text not null check (month_key ~ '^\d{4}-\d{2}$'),
  expected_fee numeric(12,2) not null default 0,
  subjects jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (workspace_id, month_key, student_id),
  foreign key (workspace_id, student_id) references public.students(workspace_id, id) on delete cascade
);

create table if not exists public.payments (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  receipt_number text not null,
  student_id text not null,
  payment_month integer not null check (payment_month between 1 and 12),
  payment_year integer not null check (payment_year between 2000 and 2200),
  payment_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  payment_method text not null,
  notes text not null default '',
  voided boolean not null default false,
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (workspace_id, id),
  unique (workspace_id, receipt_number),
  foreign key (workspace_id, student_id) references public.students(workspace_id, id) on delete cascade
);

create table if not exists public.attendance (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  student_id text not null,
  class_id text not null,
  attendance_date date not null,
  status text not null check (status in ('Present','Absent','Late','Excused')),
  reason text not null default '',
  notes text not null default '',
  recorded_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, student_id, class_id, attendance_date),
  foreign key (workspace_id, student_id) references public.students(workspace_id, id) on delete cascade,
  foreign key (workspace_id, class_id) references public.classes(workspace_id, id) on delete cascade
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id),
  user_email text not null default '',
  user_role text not null check (user_role in ('owner','co_owner')),
  action text not null,
  record_label text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_members_user on public.workspace_members(user_id, status);
create index if not exists idx_students_workspace on public.students(workspace_id);
create index if not exists idx_classes_workspace on public.classes(workspace_id);
create index if not exists idx_payments_workspace_date on public.payments(workspace_id, payment_date desc);
create index if not exists idx_attendance_workspace_date on public.attendance(workspace_id, attendance_date desc);
create index if not exists idx_audit_workspace_date on public.audit_logs(workspace_id, created_at desc);

-- Private helpers are intentionally outside the exposed public schema.
create or replace function private.is_workspace_owner(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = (select auth.uid())
      and role = 'owner' and status = 'active'
  );
$$;

create or replace function private.is_workspace_co_owner(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = (select auth.uid())
      and role = 'co_owner' and status = 'active'
  );
$$;

create or replace function private.can_manage_workspace_data(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select private.is_workspace_owner(p_workspace_id) or private.is_workspace_co_owner(p_workspace_id);
$$;

create or replace function private.shares_workspace(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = (select auth.uid()) and mine.status = 'active'
      and theirs.user_id = p_user_id and theirs.status = 'active'
  );
$$;

revoke all on all functions in schema private from public;
grant usage on schema private to authenticated;
grant execute on function private.is_workspace_owner(uuid) to authenticated;
grant execute on function private.is_workspace_co_owner(uuid) to authenticated;
grant execute on function private.can_manage_workspace_data(uuid) to authenticated;
grant execute on function private.shares_workspace(uuid) to authenticated;

-- RLS is mandatory on every exposed table.
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.students enable row level security;
alter table public.classes enable row level security;
alter table public.monthly_records enable row level security;
alter table public.payments enable row level security;
alter table public.attendance enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists profiles_select_shared on public.profiles;
create policy profiles_select_shared on public.profiles for select to authenticated
using (user_id = (select auth.uid()) or private.shares_workspace(user_id));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member on public.workspaces for select to authenticated
using (private.can_manage_workspace_data(id));
drop policy if exists workspaces_update_owner on public.workspaces;
create policy workspaces_update_owner on public.workspaces for update to authenticated
using (private.is_workspace_owner(id)) with check (private.is_workspace_owner(id));

drop policy if exists members_select_workspace on public.workspace_members;
create policy members_select_workspace on public.workspace_members for select to authenticated
using (user_id = (select auth.uid()) or private.can_manage_workspace_data(workspace_id));
drop policy if exists members_insert_owner on public.workspace_members;
create policy members_insert_owner on public.workspace_members for insert to authenticated
with check (private.is_workspace_owner(workspace_id));
drop policy if exists members_update_owner on public.workspace_members;
create policy members_update_owner on public.workspace_members for update to authenticated
using (private.is_workspace_owner(workspace_id)) with check (private.is_workspace_owner(workspace_id));
drop policy if exists members_delete_owner on public.workspace_members;
create policy members_delete_owner on public.workspace_members for delete to authenticated
using (private.is_workspace_owner(workspace_id));

drop policy if exists invites_select_workspace on public.workspace_invites;
create policy invites_select_workspace on public.workspace_invites for select to authenticated
using (private.can_manage_workspace_data(workspace_id));
drop policy if exists invites_manage_owner on public.workspace_invites;
create policy invites_manage_owner on public.workspace_invites for all to authenticated
using (private.is_workspace_owner(workspace_id)) with check (private.is_workspace_owner(workspace_id));

-- Owner and Co-owner have equal CRUD access to daily workspace data.
do $$
declare table_name text;
begin
  foreach table_name in array array['students','classes','monthly_records','payments','attendance'] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select_manage', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert_manage', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update_manage', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete_manage', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (private.can_manage_workspace_data(workspace_id))', table_name || '_select_manage', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.can_manage_workspace_data(workspace_id))', table_name || '_insert_manage', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (private.can_manage_workspace_data(workspace_id)) with check (private.can_manage_workspace_data(workspace_id))', table_name || '_update_manage', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (private.can_manage_workspace_data(workspace_id))', table_name || '_delete_manage', table_name);
  end loop;
end $$;

drop policy if exists audit_select_manage on public.audit_logs;
create policy audit_select_manage on public.audit_logs for select to authenticated
using (private.can_manage_workspace_data(workspace_id));
drop policy if exists audit_insert_manage on public.audit_logs;
create policy audit_insert_manage on public.audit_logs for insert to authenticated
with check (private.can_manage_workspace_data(workspace_id) and user_id = (select auth.uid()));

-- The original Owner membership cannot be removed, disabled or downgraded.
create or replace function private.protect_original_owner()
returns trigger language plpgsql security definer set search_path = public
as $$
declare original_owner uuid;
begin
  select owner_user_id into original_owner from public.workspaces where id = old.workspace_id;
  if old.user_id = original_owner then
    if tg_op = 'DELETE' then
      raise exception 'The original Owner cannot be removed.';
    end if;
    if new.user_id <> old.user_id or new.workspace_id <> old.workspace_id
       or new.role <> 'owner' or new.status <> 'active' then
      raise exception 'The original Owner cannot be removed, disabled or downgraded.';
    end if;
  end if;
  if tg_op = 'UPDATE' then return new; end if;
  return old;
end;
$$;

drop trigger if exists protect_original_owner_trigger on public.workspace_members;
create trigger protect_original_owner_trigger before update or delete on public.workspace_members
for each row execute function private.protect_original_owner();

-- Invited accounts are attached automatically when Supabase Auth creates them.
create or replace function private.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare invite_row public.workspace_invites%rowtype;
begin
  insert into public.profiles(user_id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), coalesce(new.email,''))
  on conflict (user_id) do update set email = excluded.email, updated_at = now();

  for invite_row in
    select * from public.workspace_invites
    where lower(email) = lower(coalesce(new.email,'')) and status = 'pending'
  loop
    insert into public.workspace_members(workspace_id,user_id,role,status)
    values (invite_row.workspace_id,new.id,invite_row.role,'active')
    on conflict (workspace_id,user_id) do update set role = excluded.role, status = 'active', updated_at = now();
    if invite_row.role = 'owner' then
      update public.workspaces set owner_user_id = coalesce(owner_user_id,new.id), updated_at = now()
      where id = invite_row.workspace_id;
    end if;
    update public.workspace_invites set status = 'accepted', updated_at = now() where id = invite_row.id;
  end loop;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_workspace on auth.users;
create trigger on_auth_user_created_workspace after insert on auth.users
for each row execute function private.handle_new_auth_user();

-- Fixed initial workspace and two permitted emails. This does not create passwords.
insert into public.workspaces(id,name)
values ('7611d6b7-30c6-4fca-a67f-4f57d80c7535','Teacher VENUS Workspace')
on conflict (id) do update set name = excluded.name;

insert into public.workspace_invites(workspace_id,email,full_name,role,status)
values
  ('7611d6b7-30c6-4fca-a67f-4f57d80c7535','enciii0831@gmail.com','Owner','owner','pending'),
  ('7611d6b7-30c6-4fca-a67f-4f57d80c7535','kxnrnlxm@gmail.com','Co-owner','co_owner','pending')
on conflict (workspace_id,email) do update set full_name=excluded.full_name, role=excluded.role,
  status=case when public.workspace_invites.status='accepted' then 'accepted' else 'pending' end, updated_at=now();

-- Also attach the two users if their Auth accounts already exist.
insert into public.profiles(user_id,full_name,email)
select u.id, case when lower(u.email)='enciii0831@gmail.com' then 'Owner' else 'Co-owner' end, u.email
from auth.users u where lower(u.email) in ('enciii0831@gmail.com','kxnrnlxm@gmail.com')
on conflict (user_id) do update set email=excluded.email, updated_at=now();

insert into public.workspace_members(workspace_id,user_id,role,status)
select '7611d6b7-30c6-4fca-a67f-4f57d80c7535', u.id,
  case when lower(u.email)='enciii0831@gmail.com' then 'owner' else 'co_owner' end, 'active'
from auth.users u where lower(u.email) in ('enciii0831@gmail.com','kxnrnlxm@gmail.com')
on conflict (workspace_id,user_id) do update set role=excluded.role,status='active',updated_at=now();

update public.workspaces w set owner_user_id=u.id,updated_at=now()
from auth.users u where w.id='7611d6b7-30c6-4fca-a67f-4f57d80c7535'
  and lower(u.email)='enciii0831@gmail.com' and w.owner_user_id is null;

update public.workspace_invites i set status='accepted',updated_at=now()
from auth.users u where i.workspace_id='7611d6b7-30c6-4fca-a67f-4f57d80c7535'
  and lower(i.email)=lower(u.email);

-- Fetches the complete workspace in the camelCase structure used by the app.
create or replace function public.get_workspace_state(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare result jsonb;
begin
  if not private.can_manage_workspace_data(p_workspace_id) then
    raise exception 'Not authorized for this workspace.';
  end if;
  select jsonb_build_object(
    'version', 2,
    'dataVersion', w.data_version,
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
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'receiptNumber',p.receipt_number,'studentId',p.student_id,'paymentMonth',p.payment_month,
      'paymentYear',p.payment_year,'paymentDate',p.payment_date,'amount',p.amount,'paymentMethod',p.payment_method,
      'notes',p.notes,'voided',p.voided,'voidedAt',p.voided_at,'voidedBy',p.voided_by,
      'createdAt',p.created_at,'updatedAt',p.updated_at
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

-- Atomic version-checked synchronization for the existing single-file app.
-- RLS still protects direct table access; this RPC repeats the authorization check.
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

  insert into public.payments(workspace_id,id,receipt_number,student_id,payment_month,payment_year,payment_date,amount,payment_method,notes,voided,voided_at,voided_by,created_at,updated_at)
  select p_workspace_id,x.id,x."receiptNumber",x."studentId",x."paymentMonth",x."paymentYear",x."paymentDate"::date,
    x.amount,x."paymentMethod",coalesce(x.notes,''),coalesce(x.voided,false),nullif(x."voidedAt",'')::timestamptz,
    nullif(x."voidedBy",'')::uuid,coalesce(nullif(x."createdAt",'')::timestamptz,now()),nullif(x."updatedAt",'')::timestamptz
  from jsonb_to_recordset(coalesce(p_state->'payments','[]'::jsonb)) as x(
    id text,"receiptNumber" text,"studentId" text,"paymentMonth" integer,"paymentYear" integer,
    "paymentDate" text,amount numeric,"paymentMethod" text,notes text,voided boolean,"voidedAt" text,"voidedBy" text,
    "createdAt" text,"updatedAt" text
  );

  insert into public.attendance(workspace_id,id,student_id,class_id,attendance_date,status,reason,notes,recorded_at)
  select p_workspace_id,x.id,x."studentId",x."classId",x."attendanceDate"::date,x.status,
    coalesce(x.reason,''),coalesce(x.notes,''),coalesce(nullif(x."recordedAt",'')::timestamptz,now())
  from jsonb_to_recordset(coalesce(p_state->'attendance','[]'::jsonb)) as x(
    id text,"studentId" text,"classId" text,"attendanceDate" text,status text,reason text,notes text,"recordedAt" text
  );

  next_version := current_version + 1;
  update public.workspaces set receipt_counters=coalesce(p_state->'receiptCounters','{}'::jsonb),
    data_version=next_version,updated_at=now() where id=p_workspace_id;

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

create or replace function public.get_workspace_directory(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare result jsonb;
begin
  if not private.can_manage_workspace_data(p_workspace_id) then raise exception 'Not authorized.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId',d.user_id,'name',d.full_name,'email',d.email,'role',d.role,'status',d.status
  ) order by case d.role when 'owner' then 0 else 1 end,d.email),'[]'::jsonb) into result
  from (
    select wm.user_id::text as user_id,p.full_name,p.email,wm.role,wm.status
    from public.workspace_members wm join public.profiles p on p.user_id=wm.user_id
    where wm.workspace_id=p_workspace_id
    union all
    select null::text,i.full_name,i.email,i.role,'invited'::text
    from public.workspace_invites i where i.workspace_id=p_workspace_id and i.status='pending'
  ) d;
  return result;
end;
$$;

create or replace function public.set_co_owner_status(p_workspace_id uuid,p_user_id uuid,p_status text)
returns void language plpgsql security definer set search_path = public
as $$
declare target_role text;
declare actor_email text;
begin
  if not private.is_workspace_owner(p_workspace_id) then raise exception 'Only the Owner can manage users.'; end if;
  if p_status not in ('active','inactive') then raise exception 'Invalid status.'; end if;
  select role into target_role from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id;
  if target_role is distinct from 'co_owner' then raise exception 'The original Owner cannot be changed.'; end if;
  update public.workspace_members set status=p_status,updated_at=now() where workspace_id=p_workspace_id and user_id=p_user_id;
  select email into actor_email from public.profiles where user_id=(select auth.uid());
  insert into public.audit_logs(workspace_id,user_id,user_email,user_role,action,record_label)
  values (p_workspace_id,(select auth.uid()),coalesce(actor_email,''),'owner',
    case when p_status='active' then 'Restored Co-owner' else 'Removed Co-owner' end,p_user_id::text);
end;
$$;

revoke all on function public.get_workspace_state(uuid) from public,anon;
revoke all on function public.sync_workspace_state(uuid,jsonb,bigint,text,text) from public,anon;
revoke all on function public.get_workspace_directory(uuid) from public,anon;
revoke all on function public.set_co_owner_status(uuid,uuid,text) from public,anon;
grant execute on function public.get_workspace_state(uuid) to authenticated;
grant execute on function public.sync_workspace_state(uuid,jsonb,bigint,text,text) to authenticated;
grant execute on function public.get_workspace_directory(uuid) to authenticated;
grant execute on function public.set_co_owner_status(uuid,uuid,text) to authenticated;
