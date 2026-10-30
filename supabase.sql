-- Mecanico Pessoal - tabelas do banco (Supabase)
-- Cole este script inteiro no "SQL Editor" do Supabase e clique em "Run".
-- Pode rodar mais de uma vez sem problema.

-- 1) Guarda o estado do sistema: perfil do carro, ultimo diagnostico, chat do Telegram
create table if not exists kv (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- 2) Controle de combustivel
create table if not exists abastecimentos (
  id             bigint generated always as identity primary key,
  data           timestamptz not null default now(),
  tipo           text not null check (tipo in ('gasolina', 'etanol', 'gnv')),
  quantidade     numeric(8, 2) not null check (quantidade > 0),   -- litros (ou m3 no GNV)
  preco_unitario numeric(8, 3) not null check (preco_unitario > 0),
  total          numeric(10, 2) not null,
  km             integer,
  cheio          boolean not null default true
);

create index if not exists abastecimentos_data_idx on abastecimentos (data desc);

-- 3) Seguranca: liga o RLS e NAO cria nenhuma politica.
-- Assim a chave publica (publishable/anon) nao consegue ler nem escrever nada;
-- so o servidor, com a chave secreta, acessa estas tabelas.
alter table kv enable row level security;
alter table abastecimentos enable row level security;
