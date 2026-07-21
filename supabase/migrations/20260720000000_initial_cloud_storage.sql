create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id text not null,
  name text not null,
  commander_name text,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, deck_id)
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id text not null,
  analysis_id text not null,
  kind text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, deck_id, analysis_id),
  foreign key (user_id, deck_id) references public.decks(user_id, deck_id) on delete cascade
);

create table public.graph_patches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id text not null,
  patch_key text not null,
  patch jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, deck_id, patch_key),
  foreign key (user_id, deck_id) references public.decks(user_id, deck_id) on delete cascade
);

create table public.question_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id text not null,
  thread_id text not null,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, deck_id, thread_id),
  unique (user_id, thread_id),
  foreign key (user_id, deck_id) references public.decks(user_id, deck_id) on delete cascade
);

create table public.question_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id text not null,
  message_id text not null,
  question text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, thread_id, message_id),
  foreign key (user_id, thread_id) references public.question_threads(user_id, thread_id) on delete cascade
);

create table public.user_app_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger set_decks_updated_at
before update on public.decks
for each row execute function public.set_updated_at();

create trigger set_graph_patches_updated_at
before update on public.graph_patches
for each row execute function public.set_updated_at();

create trigger set_question_threads_updated_at
before update on public.question_threads
for each row execute function public.set_updated_at();

create trigger set_user_app_states_updated_at
before update on public.user_app_states
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.decks enable row level security;
alter table public.analyses enable row level security;
alter table public.graph_patches enable row level security;
alter table public.question_threads enable row level security;
alter table public.question_messages enable row level security;
alter table public.user_app_states enable row level security;

create policy "Users can read their profile"
on public.profiles for select
using (auth.uid() = id);

create policy "Users can insert their profile"
on public.profiles for insert
with check (auth.uid() = id);

create policy "Users can update their profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Users can delete their profile"
on public.profiles for delete
using (auth.uid() = id);

create policy "Users can read their decks"
on public.decks for select
using (auth.uid() = user_id);

create policy "Users can insert their decks"
on public.decks for insert
with check (auth.uid() = user_id);

create policy "Users can update their decks"
on public.decks for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their decks"
on public.decks for delete
using (auth.uid() = user_id);

create policy "Users can read their analyses"
on public.analyses for select
using (auth.uid() = user_id);

create policy "Users can insert their analyses"
on public.analyses for insert
with check (auth.uid() = user_id);

create policy "Users can update their analyses"
on public.analyses for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their analyses"
on public.analyses for delete
using (auth.uid() = user_id);

create policy "Users can read their graph patches"
on public.graph_patches for select
using (auth.uid() = user_id);

create policy "Users can insert their graph patches"
on public.graph_patches for insert
with check (auth.uid() = user_id);

create policy "Users can update their graph patches"
on public.graph_patches for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their graph patches"
on public.graph_patches for delete
using (auth.uid() = user_id);

create policy "Users can read their question threads"
on public.question_threads for select
using (auth.uid() = user_id);

create policy "Users can insert their question threads"
on public.question_threads for insert
with check (auth.uid() = user_id);

create policy "Users can update their question threads"
on public.question_threads for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their question threads"
on public.question_threads for delete
using (auth.uid() = user_id);

create policy "Users can read their question messages"
on public.question_messages for select
using (auth.uid() = user_id);

create policy "Users can insert their question messages"
on public.question_messages for insert
with check (auth.uid() = user_id);

create policy "Users can update their question messages"
on public.question_messages for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their question messages"
on public.question_messages for delete
using (auth.uid() = user_id);

create policy "Users can read their app state"
on public.user_app_states for select
using (auth.uid() = user_id);

create policy "Users can insert their app state"
on public.user_app_states for insert
with check (auth.uid() = user_id);

create policy "Users can update their app state"
on public.user_app_states for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their app state"
on public.user_app_states for delete
using (auth.uid() = user_id);
