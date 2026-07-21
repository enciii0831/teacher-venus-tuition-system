-- Add Malaysian primary year levels while preserving all existing Form levels.

begin;

alter table public.students
  drop constraint if exists students_form_check;

alter table public.students
  add constraint students_form_check
  check (form in ('Y1','Y2','Y3','Y4','Y5','Y6','F1','F2','F3','F4','F5'));

alter table public.classes
  drop constraint if exists classes_form_check;

alter table public.classes
  add constraint classes_form_check
  check (form in ('Y1','Y2','Y3','Y4','Y5','Y6','F1','F2','F3','F4','F5'));

commit;
