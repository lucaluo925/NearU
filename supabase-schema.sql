-- Davis Explorer: Supabase Database Schema
-- Run this in Supabase SQL Editor

-- Items table
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  subcategory text not null,
  description text,
  location_name text,
  address text not null,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  start_time timestamptz,
  end_time timestamptz,
  external_link text,
  flyer_image_url text,
  source text not null default 'user',
  tags text[] not null default '{}',
  created_by text,
  created_at timestamptz not null default now(),
  -- Soft delete
  deleted_at timestamptz,

  -- Validation: at least one of external_link or flyer_image_url must be present
  constraint requires_link_or_flyer check (
    external_link is not null or flyer_image_url is not null
  ),
  -- Validation: end_time must be >= start_time
  constraint end_after_start check (
    end_time is null or start_time is null or end_time >= start_time
  )
);

-- Unique constraint for duplicate prevention
create unique index if not exists items_title_start_time_unique
  on items (lower(title), start_time)
  where deleted_at is null and start_time is not null;

-- Enable Row Level Security
alter table items enable row level security;

-- Public read policy (anyone can browse)
create policy "Public can read active items"
  on items for select
  using (deleted_at is null);

-- Public insert policy (anyone can submit)
create policy "Public can insert items"
  on items for insert
  with check (true);

-- Admin delete (service role or authenticated admin)
create policy "Authenticated users can soft delete"
  on items for update
  using (auth.role() = 'authenticated');

-- Indexes for performance
create index if not exists items_category_idx on items (category) where deleted_at is null;
create index if not exists items_subcategory_idx on items (subcategory) where deleted_at is null;
create index if not exists items_start_time_idx on items (start_time) where deleted_at is null;
create index if not exists items_created_at_idx on items (created_at desc) where deleted_at is null;
create index if not exists items_tags_idx on items using gin (tags) where deleted_at is null;

-- Rate limiting table (simple IP-based)
create table if not exists submission_log (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists submission_log_ip_time_idx
  on submission_log (ip_hash, created_at desc);

-- Storage bucket (run separately in Supabase Dashboard > Storage)
-- Create a bucket named "flyers" with public access
-- Or run:
-- insert into storage.buckets (id, name, public) values ('flyers', 'flyers', true);
