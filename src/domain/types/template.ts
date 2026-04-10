export type TemplateScope = 'record' | 'report' | 'page' | 'email';
export type TemplateType = 'row' | 'header' | 'footer' | 'detail' | 'full';

export interface Template {
  id: number;
  app_id: number;
  template_scope: TemplateScope;
  template_type: TemplateType;
  related_id: number | null;
  content_html: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateInput {
  app_id: number;
  template_scope: TemplateScope;
  template_type: TemplateType;
  related_id?: number | null;
  content_html: string;
}

export interface UpdateTemplateInput {
  template_scope?: TemplateScope;
  template_type?: TemplateType;
  related_id?: number | null;
  content_html?: string;
}
