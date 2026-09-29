-- Motor de campanhas: estrutura no Supabase (Postgres + Storage).
-- Rode uma vez no SQL Editor do projeto. Pode rodar de novo sem perder dados.
--
-- Acesso: o servidor usa a chave service_role, que ignora o RLS. O RLS fica ligado e sem
-- políticas para que a chave anon (pública) não leia nem grave nada nestas tabelas.

create extension if not exists pgcrypto;

-- Peças: colunas usadas em filtros e ordenação; o restante da peça fica em "dados" (jsonb).
create table if not exists public.pecas (
  id             uuid primary key default gen_random_uuid(),
  criada_em      timestamptz not null default now(),
  atualizada_em  timestamptz not null default now(),
  status         text not null,
  etapa          text,
  categoria      text,
  dados          jsonb not null default '{}'::jsonb
);

create index if not exists pecas_criada_em_idx on public.pecas (criada_em desc);
create index if not exists pecas_status_criada_em_idx on public.pecas (status, criada_em desc);

-- Trilha de auditoria: cada etapa, decisão e intervenção humana. Eventos gerais (pausa,
-- mudança de autonomia) ficam com peca_id nulo.
create table if not exists public.auditoria (
  id       bigint generated always as identity primary key,
  peca_id  uuid references public.pecas (id) on delete cascade,
  em       timestamptz not null default now(),
  etapa    text not null,
  ator     text not null,
  resumo   text,
  detalhe  jsonb
);

create index if not exists auditoria_peca_em_idx on public.auditoria (peca_id, em);

-- Modo de cada categoria na escada de autonomia.
create table if not exists public.estado_categorias (
  id              text primary key,
  modo            text not null check (modo in ('auto', 'humano')),
  atualizado_em   timestamptz not null default now(),
  atualizado_por  text
);

-- Controle geral (pausa de emergência). Uma única linha, id = 1.
create table if not exists public.controle (
  id              integer primary key check (id = 1),
  pausado         boolean not null default false,
  motivo          text,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  text
);

insert into public.controle (id, pausado) values (1, false) on conflict (id) do nothing;

alter table public.pecas enable row level security;
alter table public.auditoria enable row level security;
alter table public.estado_categorias enable row level security;
alter table public.controle enable row level security;

-- Bucket das imagens. Precisa ser público: o Instagram baixa a arte pela URL no momento da
-- publicação. Os nomes dos arquivos começam com o UUID da peça.
insert into storage.buckets (id, name, public)
values ('pecas', 'pecas', true)
on conflict (id) do nothing;
