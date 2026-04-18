export type DatabaseMode = 'sqlite' | 'mysql' | 'postgres';

export interface App {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  database_mode: DatabaseMode;
  database_config_json: string | null;
  diagram_json: string | null;
  allowed_origins_json: string | null;
  member_css_url: string | null;
  member_header_html: string | null;
  member_footer_html: string | null;
  created_at: string;
  updated_at: string;
}

export interface SqliteConfig {
  path: string;
}

export interface RemoteDbConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

export type DbConfig = SqliteConfig | RemoteDbConfig;

export interface CreateAppInput {
  name: string;
  slug: string;
  description?: string | null;
  database_mode?: DatabaseMode;
  database_config_json?: string | null;
}

export interface UpdateAppInput {
  name?: string;
  slug?: string;
  description?: string | null;
  database_mode?: DatabaseMode;
  database_config_json?: string | null;
  allowed_origins_json?: string | null;
  member_css_url?: string | null;
  member_header_html?: string | null;
  member_footer_html?: string | null;
}
