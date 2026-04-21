import nunjucks from 'nunjucks';
import * as membersService from '../../services/members';
import type { App } from '../../domain/types';

export function renderBrandingTemplate(
  template: string,
  app: App,
  member: object | null,
  portalHeader = '',
  portalFooter = '',
): string {
  try {
    const resolved = template
      .replace(/\$portal_header/g, portalHeader)
      .replace(/\$portal_footer/g, portalFooter);
    return nunjucks.renderString(resolved, {
      app,
      member,
      logoutUrl: `/app/${app.slug}/logout`,
    });
  } catch (err: any) {
    return `<!-- branding template error: ${err.message} -->`;
  }
}

export async function getBranding(app: App, memberId: number | null) {
  const memberData = memberId ? await membersService.getMember(memberId) : null;
  const headerHtml = app.member_header_html
    ? renderBrandingTemplate(app.member_header_html, app, memberData ?? null)
    : null;
  const footerHtml = app.member_footer_html
    ? renderBrandingTemplate(app.member_footer_html, app, memberData ?? null)
    : null;
  return { headerHtml, footerHtml };
}
