-- =====================================================================
--  Tomo · base de datos
--  Pega todo este archivo en Supabase → SQL Editor → New query → Run.
--  Se puede ejecutar más de una vez sin romper nada.
-- =====================================================================

-- Perfil de cada lector: su ID (TOMO-XXXXX), su correo real y su nombre
create table if not exists public.perfiles (
  user_id      uuid primary key references auth.users on delete cascade,
  codigo       text not null unique,
  email        text not null,
  nombre       text,
  debe_cambiar boolean not null default true,   -- true = tiene contraseña temporal
  ultimo_reset timestamptz,
  creado       timestamptz not null default now()
);
create unique index if not exists perfiles_email_idx on public.perfiles (lower(email));

-- El estante completo de cada lector (libros, colecciones y lista de deseos)
create table if not exists public.estantes (
  user_id     uuid primary key references auth.users on delete cascade,
  datos       jsonb not null default '{}'::jsonb,
  version     integer not null default 0,          -- evita que dos dispositivos se pisen
  actualizado timestamptz not null default now()
);

-- Solicitudes de cuenta: tú las apruebas desde el correo que te llega
create table if not exists public.solicitudes (
  id       uuid primary key default gen_random_uuid(),
  email    text not null,
  nombre   text,
  mensaje  text,
  token    uuid not null unique default gen_random_uuid(),
  estado   text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada')),
  user_id  uuid references auth.users on delete set null,
  creado   timestamptz not null default now(),
  resuelto timestamptz
);
create index if not exists solicitudes_email_idx on public.solicitudes (lower(email), estado);

-- ---------------------------------------------------------------------
--  Seguridad: cada quien ve y edita solo lo suyo
-- ---------------------------------------------------------------------
alter table public.perfiles    enable row level security;
alter table public.estantes    enable row level security;
alter table public.solicitudes enable row level security;   -- sin políticas: solo el servidor la usa

drop policy if exists "leer mi perfil" on public.perfiles;
create policy "leer mi perfil" on public.perfiles
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "editar mi perfil" on public.perfiles;
create policy "editar mi perfil" on public.perfiles
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- del perfil, el lector solo puede cambiar su nombre y el aviso de contraseña temporal
revoke update on public.perfiles from authenticated, anon;
grant update (nombre, debe_cambiar) on public.perfiles to authenticated;

drop policy if exists "leer mi estante" on public.estantes;
create policy "leer mi estante" on public.estantes
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "crear mi estante" on public.estantes;
create policy "crear mi estante" on public.estantes
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "guardar mi estante" on public.estantes;
create policy "guardar mi estante" on public.estantes
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.solicitudes from anon, authenticated;

-- ---------------------------------------------------------------------
--  Fotos de portada: carpeta privada por lector (portadas/<su id>/...)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portadas', 'portadas', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "ver mis portadas" on storage.objects;
create policy "ver mis portadas" on storage.objects
  for select to authenticated
  using (bucket_id = 'portadas' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "subir mis portadas" on storage.objects;
create policy "subir mis portadas" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'portadas' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "cambiar mis portadas" on storage.objects;
create policy "cambiar mis portadas" on storage.objects
  for update to authenticated
  using (bucket_id = 'portadas' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "borrar mis portadas" on storage.objects;
create policy "borrar mis portadas" on storage.objects
  for delete to authenticated
  using (bucket_id = 'portadas' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------
--  Estante compartido: un enlace secreto para que cualquiera vea tu estante
--  y tu lista de deseos sin iniciar sesión. Lo lee solo la función "compartido".
--  Borrar la fila = el enlace deja de funcionar.
-- ---------------------------------------------------------------------
create table if not exists public.compartidos (
  user_id uuid primary key references auth.users on delete cascade,
  token   uuid not null unique default gen_random_uuid(),
  creado  timestamptz not null default now()
);
alter table public.compartidos enable row level security;

drop policy if exists "ver mi enlace" on public.compartidos;
create policy "ver mi enlace" on public.compartidos
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "crear mi enlace" on public.compartidos;
create policy "crear mi enlace" on public.compartidos
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "borrar mi enlace" on public.compartidos;
create policy "borrar mi enlace" on public.compartidos
  for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.compartidos from anon;
-- el enlace lo inventa la base de datos (al azar), no el lector
revoke insert on public.compartidos from authenticated;
grant insert (user_id) on public.compartidos to authenticated;

-- ---------------------------------------------------------------------
--  Comentarios: lo que los lectores envían desde "Mi cuenta → Enviar comentario".
--  Cada lector solo puede enviar (no ver ni cambiar). Te llegan por correo
--  (función "comentario") y quedan todos en Table Editor → comentarios.
-- ---------------------------------------------------------------------
create table if not exists public.comentarios (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  tipo     text not null default 'otro' check (tipo in ('idea','error','otro')),
  texto    text not null check (char_length(texto) between 1 and 2000),
  contexto jsonb not null default '{}'::jsonb,
  leido    boolean not null default false,
  creado   timestamptz not null default now()
);
alter table public.comentarios enable row level security;
drop policy if exists "enviar comentario" on public.comentarios;
create policy "enviar comentario" on public.comentarios
  for insert to authenticated with check (user_id = (select auth.uid()));
revoke all on public.comentarios from anon;
revoke select, update, delete on public.comentarios from authenticated;
