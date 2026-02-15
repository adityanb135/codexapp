-- ERP Core + RBAC + Audit (Migration 001)
-- Project: dozgdwhcgjzozmzofxny

create extension if not exists pgcrypto;

-- ---------- Generic helpers ----------
create or replace function public.set_row_timestamps()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at = coalesce(new.created_at, now());
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- RBAC ----------
create table if not exists public.erp_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_modules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_module_pages (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.erp_modules(id) on delete cascade,
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module_id, code)
);

create table if not exists public.erp_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role_id uuid references public.erp_roles(id),
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_role_page_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.erp_roles(id) on delete cascade,
  page_id uuid not null references public.erp_module_pages(id) on delete cascade,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_approve boolean not null default false,
  can_reject boolean not null default false,
  can_delete boolean not null default false,
  can_export boolean not null default false,
  can_configure boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role_id, page_id)
);

create table if not exists public.erp_user_page_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.erp_users(id) on delete cascade,
  page_id uuid not null references public.erp_module_pages(id) on delete cascade,
  can_view boolean,
  can_create boolean,
  can_edit boolean,
  can_approve boolean,
  can_reject boolean,
  can_delete boolean,
  can_export boolean,
  can_configure boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, page_id)
);

-- ---------- Audit ----------
create table if not exists public.erp_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_auth_user_id uuid,
  actor_email text,
  action_type text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  ip_address inet,
  user_agent text,
  occurred_at timestamptz not null default now(),
  trace_id text
);

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'erp_audit_logs is immutable';
end;
$$;

drop trigger if exists trg_no_update_erp_audit_logs on public.erp_audit_logs;
drop trigger if exists trg_no_delete_erp_audit_logs on public.erp_audit_logs;

create trigger trg_no_update_erp_audit_logs
before update on public.erp_audit_logs
for each row execute function public.prevent_audit_mutation();

create trigger trg_no_delete_erp_audit_logs
before delete on public.erp_audit_logs
for each row execute function public.prevent_audit_mutation();

-- ---------- ERP core tables ----------
create table if not exists public.erp_customers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  currency_code text not null default 'INR',
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_vendors (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  uom text not null default 'kg',
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_enquiries (
  id uuid primary key default gen_random_uuid(),
  enquiry_no text not null unique,
  customer_id uuid not null references public.erp_customers(id),
  product_id uuid not null references public.erp_products(id),
  quantity numeric(18,3) not null,
  delivery_date date,
  ai_probability_score numeric(5,2),
  status text not null default 'OPEN',
  created_by uuid references public.erp_users(id),
  updated_by uuid references public.erp_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_quotations (
  id uuid primary key default gen_random_uuid(),
  quotation_no text not null unique,
  enquiry_id uuid not null references public.erp_enquiries(id) on delete cascade,
  margin_percent numeric(5,2),
  status text not null default 'DRAFT',
  expires_on date,
  created_by uuid references public.erp_users(id),
  updated_by uuid references public.erp_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_work_orders (
  id uuid primary key default gen_random_uuid(),
  work_order_no text not null unique,
  quotation_id uuid not null references public.erp_quotations(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN',
  created_by uuid references public.erp_users(id),
  updated_by uuid references public.erp_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_sales_orders (
  id uuid primary key default gen_random_uuid(),
  sales_order_no text not null unique,
  quotation_id uuid not null references public.erp_quotations(id),
  status text not null default 'DRAFT',
  credit_status text not null default 'PENDING',
  created_by uuid references public.erp_users(id),
  updated_by uuid references public.erp_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Timestamp triggers ----------
do $$
declare t text;
begin
  foreach t in array array[
    'erp_roles','erp_modules','erp_module_pages','erp_users',
    'erp_role_page_permissions','erp_user_page_overrides',
    'erp_customers','erp_vendors','erp_products','erp_enquiries',
    'erp_quotations','erp_work_orders','erp_sales_orders'
  ]
  loop
    execute format('drop trigger if exists trg_set_ts_%s on public.%s', t, t);
    execute format('create trigger trg_set_ts_%s before insert or update on public.%s for each row execute function public.set_row_timestamps()', t, t);
  end loop;
end;
$$;

-- ---------- Permission functions ----------
create or replace function public.current_erp_user_id()
returns uuid
language sql
stable
as $$
  select id from public.erp_users where auth_user_id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.erp_users u
    join public.erp_roles r on r.id = u.role_id
    where u.auth_user_id = auth.uid()
      and r.code = 'SUPER_ADMIN'
      and u.status = 'ACTIVE'
  );
$$;

create or replace function public.has_page_permission(
  p_module_code text,
  p_page_code text,
  p_action text
)
returns boolean
language plpgsql
stable
as $$
declare
  v_user_id uuid;
  v_page_id uuid;
  v_override boolean;
  v_role_value boolean;
begin
  if public.is_super_admin() then
    return true;
  end if;

  select u.id into v_user_id
  from public.erp_users u
  where u.auth_user_id = auth.uid()
    and u.status = 'ACTIVE';

  if v_user_id is null then
    return false;
  end if;

  select p.id into v_page_id
  from public.erp_module_pages p
  join public.erp_modules m on m.id = p.module_id
  where m.code = p_module_code and p.code = p_page_code;

  if v_page_id is null then
    return false;
  end if;

  execute format(
    'select %I from public.erp_user_page_overrides where user_id = $1 and page_id = $2',
    'can_' || lower(p_action)
  )
  into v_override
  using v_user_id, v_page_id;

  if v_override is not null then
    return v_override;
  end if;

  execute format(
    'select rp.%I
     from public.erp_users u
     join public.erp_role_page_permissions rp on rp.role_id = u.role_id
     where u.id = $1 and rp.page_id = $2',
    'can_' || lower(p_action)
  )
  into v_role_value
  using v_user_id, v_page_id;

  return coalesce(v_role_value, false);
end;
$$;

-- ---------- Seed modules/pages/roles ----------
insert into public.erp_roles(code, name, is_system) values
  ('SUPER_ADMIN','Super Admin',true),
  ('PURCHASE_MANAGER','Purchase Manager',true),
  ('SALES_MANAGER','Sales Manager',true),
  ('MASTER_DATA_ADMIN','Master Data Admin',true),
  ('PRE_PROCESSING_SUPERVISOR','Pre-Processing Supervisor',true),
  ('QC_MANAGER','QC Manager',true),
  ('SIZE_REDUCTION_SUPERVISOR','Size Reduction Supervisor',true),
  ('ACCOUNTS_MANAGER','Accounts Manager',true),
  ('PACKAGING_SUPERVISOR','Packaging Supervisor',true),
  ('DISPATCH_SUPERVISOR','Dispatch Supervisor',true)
on conflict (code) do nothing;

insert into public.erp_modules(code, name) values
  ('SUPER_ADMIN','Super Admin'),
  ('PURCHASE','Purchase'),
  ('SALES','Sales'),
  ('MASTER_DATA','Master Data'),
  ('PRE_PROCESSING','Pre-Processing'),
  ('INSPECTION','Inspection'),
  ('SIZE_REDUCTION','Size Reduction'),
  ('INVOICING','Invoicing'),
  ('PACKAGING','Packaging'),
  ('DISPATCH','Dispatch')
on conflict (code) do nothing;

with pages(module_code, page_code, page_name) as (
  values
    ('SUPER_ADMIN','DASHBOARD','Dashboard'),
    ('SUPER_ADMIN','USERS','Users'),
    ('SUPER_ADMIN','ACCESS_CONTROL','Access Control'),
    ('SUPER_ADMIN','AUDIT','Audit'),
    ('SUPER_ADMIN','ANALYTICS','Analytics'),
    ('PURCHASE','REQUISITIONS','Requisitions'),
    ('PURCHASE','VENDORS','Vendors'),
    ('PURCHASE','GRN','GRN'),
    ('SALES','ENQUIRIES','Enquiries'),
    ('SALES','QUOTATIONS','Quotations'),
    ('SALES','SALES_ORDERS','Sales Orders'),
    ('MASTER_DATA','PRODUCTS','Products'),
    ('MASTER_DATA','CUSTOMERS','Customers'),
    ('MASTER_DATA','BOM','BOM'),
    ('PRE_PROCESSING','BATCH_INTAKE','Batch Intake'),
    ('PRE_PROCESSING','WASH_SORT','Wash & Sort'),
    ('INSPECTION','QC_ENTRY','QC Entry'),
    ('INSPECTION','NCR','NCR'),
    ('SIZE_REDUCTION','JOB_CARDS','Job Cards'),
    ('SIZE_REDUCTION','MACHINE_LOGS','Machine Logs'),
    ('INVOICING','INVOICES','Invoices'),
    ('INVOICING','PAYMENTS','Payments'),
    ('PACKAGING','PACKING_SLIPS','Packing Slips'),
    ('PACKAGING','LABELS','Labels'),
    ('DISPATCH','DISPATCH_ORDERS','Dispatch Orders'),
    ('DISPATCH','TRACKING','Tracking')
)
insert into public.erp_module_pages(module_id, code, name)
select m.id, p.page_code, p.page_name
from pages p
join public.erp_modules m on m.code = p.module_code
on conflict (module_id, code) do nothing;

-- Give Super Admin full permissions across all pages
insert into public.erp_role_page_permissions(
  role_id, page_id, can_view, can_create, can_edit, can_approve, can_reject, can_delete, can_export, can_configure
)
select
  r.id,
  p.id,
  true, true, true, true, true, true, true, true
from public.erp_roles r
cross join public.erp_module_pages p
where r.code = 'SUPER_ADMIN'
on conflict (role_id, page_id) do update
set can_view = excluded.can_view,
    can_create = excluded.can_create,
    can_edit = excluded.can_edit,
    can_approve = excluded.can_approve,
    can_reject = excluded.can_reject,
    can_delete = excluded.can_delete,
    can_export = excluded.can_export,
    can_configure = excluded.can_configure;

-- ---------- RLS ----------
alter table public.erp_users enable row level security;
alter table public.erp_roles enable row level security;
alter table public.erp_modules enable row level security;
alter table public.erp_module_pages enable row level security;
alter table public.erp_role_page_permissions enable row level security;
alter table public.erp_user_page_overrides enable row level security;
alter table public.erp_audit_logs enable row level security;
alter table public.erp_customers enable row level security;
alter table public.erp_vendors enable row level security;
alter table public.erp_products enable row level security;
alter table public.erp_enquiries enable row level security;
alter table public.erp_quotations enable row level security;
alter table public.erp_work_orders enable row level security;
alter table public.erp_sales_orders enable row level security;

-- Admin-centric governance
drop policy if exists p_roles_super_admin on public.erp_roles;
create policy p_roles_super_admin on public.erp_roles for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists p_modules_read_auth on public.erp_modules;
create policy p_modules_read_auth on public.erp_modules for select
to authenticated
using (true);

drop policy if exists p_pages_read_auth on public.erp_module_pages;
create policy p_pages_read_auth on public.erp_module_pages for select
to authenticated
using (true);

drop policy if exists p_users_super_admin_all on public.erp_users;
create policy p_users_super_admin_all on public.erp_users for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists p_users_self_select on public.erp_users;
create policy p_users_self_select on public.erp_users for select
to authenticated
using (auth.uid() = auth_user_id);

drop policy if exists p_role_perm_super_admin on public.erp_role_page_permissions;
create policy p_role_perm_super_admin on public.erp_role_page_permissions for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists p_user_override_super_admin on public.erp_user_page_overrides;
create policy p_user_override_super_admin on public.erp_user_page_overrides for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists p_audit_select_super_admin on public.erp_audit_logs;
create policy p_audit_select_super_admin on public.erp_audit_logs for select
to authenticated
using (public.is_super_admin());

drop policy if exists p_audit_insert_auth on public.erp_audit_logs;
create policy p_audit_insert_auth on public.erp_audit_logs for insert
to authenticated
with check (true);

-- Domain tables tied to page permissions (view/create/edit/delete)
drop policy if exists p_customers_select on public.erp_customers;
create policy p_customers_select on public.erp_customers for select
to authenticated
using (public.has_page_permission('MASTER_DATA','CUSTOMERS','view'));
drop policy if exists p_customers_ins on public.erp_customers;
create policy p_customers_ins on public.erp_customers for insert
to authenticated
with check (public.has_page_permission('MASTER_DATA','CUSTOMERS','create'));
drop policy if exists p_customers_upd on public.erp_customers;
create policy p_customers_upd on public.erp_customers for update
to authenticated
using (public.has_page_permission('MASTER_DATA','CUSTOMERS','edit'))
with check (public.has_page_permission('MASTER_DATA','CUSTOMERS','edit'));
drop policy if exists p_customers_del on public.erp_customers;
create policy p_customers_del on public.erp_customers for delete
to authenticated
using (public.has_page_permission('MASTER_DATA','CUSTOMERS','delete'));

drop policy if exists p_products_select on public.erp_products;
create policy p_products_select on public.erp_products for select
to authenticated
using (public.has_page_permission('MASTER_DATA','PRODUCTS','view'));
drop policy if exists p_products_ins on public.erp_products;
create policy p_products_ins on public.erp_products for insert
to authenticated
with check (public.has_page_permission('MASTER_DATA','PRODUCTS','create'));
drop policy if exists p_products_upd on public.erp_products;
create policy p_products_upd on public.erp_products for update
to authenticated
using (public.has_page_permission('MASTER_DATA','PRODUCTS','edit'))
with check (public.has_page_permission('MASTER_DATA','PRODUCTS','edit'));
drop policy if exists p_products_del on public.erp_products;
create policy p_products_del on public.erp_products for delete
to authenticated
using (public.has_page_permission('MASTER_DATA','PRODUCTS','delete'));

drop policy if exists p_enquiries_select on public.erp_enquiries;
create policy p_enquiries_select on public.erp_enquiries for select
to authenticated
using (public.has_page_permission('SALES','ENQUIRIES','view'));
drop policy if exists p_enquiries_ins on public.erp_enquiries;
create policy p_enquiries_ins on public.erp_enquiries for insert
to authenticated
with check (public.has_page_permission('SALES','ENQUIRIES','create'));
drop policy if exists p_enquiries_upd on public.erp_enquiries;
create policy p_enquiries_upd on public.erp_enquiries for update
to authenticated
using (public.has_page_permission('SALES','ENQUIRIES','edit'))
with check (public.has_page_permission('SALES','ENQUIRIES','edit'));
drop policy if exists p_enquiries_del on public.erp_enquiries;
create policy p_enquiries_del on public.erp_enquiries for delete
to authenticated
using (public.has_page_permission('SALES','ENQUIRIES','delete'));

drop policy if exists p_quotations_select on public.erp_quotations;
create policy p_quotations_select on public.erp_quotations for select
to authenticated
using (public.has_page_permission('SALES','QUOTATIONS','view'));
drop policy if exists p_quotations_ins on public.erp_quotations;
create policy p_quotations_ins on public.erp_quotations for insert
to authenticated
with check (public.has_page_permission('SALES','QUOTATIONS','create'));
drop policy if exists p_quotations_upd on public.erp_quotations;
create policy p_quotations_upd on public.erp_quotations for update
to authenticated
using (public.has_page_permission('SALES','QUOTATIONS','edit'))
with check (public.has_page_permission('SALES','QUOTATIONS','edit'));
drop policy if exists p_quotations_del on public.erp_quotations;
create policy p_quotations_del on public.erp_quotations for delete
to authenticated
using (public.has_page_permission('SALES','QUOTATIONS','delete'));

drop policy if exists p_work_orders_select on public.erp_work_orders;
create policy p_work_orders_select on public.erp_work_orders for select
to authenticated
using (public.has_page_permission('SALES','QUOTATIONS','view'));
drop policy if exists p_work_orders_ins on public.erp_work_orders;
create policy p_work_orders_ins on public.erp_work_orders for insert
to authenticated
with check (public.has_page_permission('SALES','QUOTATIONS','create'));
drop policy if exists p_work_orders_upd on public.erp_work_orders;
create policy p_work_orders_upd on public.erp_work_orders for update
to authenticated
using (public.has_page_permission('SALES','QUOTATIONS','edit'))
with check (public.has_page_permission('SALES','QUOTATIONS','edit'));
drop policy if exists p_work_orders_del on public.erp_work_orders;
create policy p_work_orders_del on public.erp_work_orders for delete
to authenticated
using (public.has_page_permission('SALES','QUOTATIONS','delete'));

drop policy if exists p_sales_orders_select on public.erp_sales_orders;
create policy p_sales_orders_select on public.erp_sales_orders for select
to authenticated
using (public.has_page_permission('SALES','SALES_ORDERS','view'));
drop policy if exists p_sales_orders_ins on public.erp_sales_orders;
create policy p_sales_orders_ins on public.erp_sales_orders for insert
to authenticated
with check (public.has_page_permission('SALES','SALES_ORDERS','create'));
drop policy if exists p_sales_orders_upd on public.erp_sales_orders;
create policy p_sales_orders_upd on public.erp_sales_orders for update
to authenticated
using (public.has_page_permission('SALES','SALES_ORDERS','edit'))
with check (public.has_page_permission('SALES','SALES_ORDERS','edit'));
drop policy if exists p_sales_orders_del on public.erp_sales_orders;
create policy p_sales_orders_del on public.erp_sales_orders for delete
to authenticated
using (public.has_page_permission('SALES','SALES_ORDERS','delete'));
