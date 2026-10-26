create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text,
    username text,
    avatar_url text,
    email text,
    is_paid boolean not null default false,
    created_portfolios integer not null default 0,
    published_portfolios integer not null default 0,
    draft_portfolios integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.portfolios (
    id uuid primary key default gen_random_uuid(),
    templateid text,
    sitedata jsonb,
    userid uuid references public.profiles(id),
    isdeployed boolean,
    isdraft boolean,
    liveurl text,
    name text,
    description text,
    hosting text,
    iscustomdomain boolean default false,
    customdomain text,
    domain_verified boolean default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.portfolio_seo (
    id uuid primary key default gen_random_uuid(),
    portfolio_id uuid not null unique references public.portfolios(id) on delete cascade,
    title text,
    description text,
    keywords text,
    meta_title text,              -- leftover, duplicates title
    meta_description text,        -- leftover, duplicates description
    google_account_email text,
    google_tokens jsonb,
    google_verification_token text,
    google_verified boolean default false,
    sitemap_submitted boolean default false,
    is_indexed boolean default false,
    last_crawled_at timestamptz,
    inspection_result jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.deploy_credentials (
    id uuid primary key default gen_random_uuid(),
    userid uuid references public.profiles(id),
    platform text not null,
    access_token text not null,
    team_id text,
    created_at timestamptz not null default now(),
    unique (userid, platform)
);