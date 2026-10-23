-- ===== Foodastry: структура базы для Supabase =====
-- Как применить: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Выполняется один раз на проект.

create table if not exists foods (
  name  text primary key,
  k double precision not null default 0, -- ккал на 100 г
  p double precision not null default 0, -- белки
  f double precision not null default 0, -- жиры
  c double precision not null default 0, -- углеводы
  tbsp double precision,                 -- г в ст. ложке
  tsp  double precision,                 -- г в ч. ложке
  piece double precision,                -- г в 1 шт
  d    double precision                  -- г/мл (для миллилитров)
);

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  servings double precision not null default 1,
  ingredients jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at выставляется в момент правки автоматически
create or replace function foodastry_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists recipes_touch_updated_at on recipes;
create trigger recipes_touch_updated_at
  before update on recipes
  for each row execute function foodastry_touch_updated_at();

-- Доступ открытый: аккаунтов нет, конфиденциальных данных в книге тоже нет.
-- Читать и редактировать может любой, у кого ссылка на книгу.
alter table foods   enable row level security;
alter table recipes enable row level security;

drop policy if exists "foodastry public" on foods;
create policy "foodastry public" on foods
  for all using (true) with check (true);

drop policy if exists "foodastry public" on recipes;
create policy "foodastry public" on recipes
  for all using (true) with check (true);
