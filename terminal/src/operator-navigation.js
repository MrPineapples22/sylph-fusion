// Presentation-only route state. A URL identifies context; it never grants authority.
export const WORKSPACES = ['Command', 'Aether Flux', 'Token Intelligence', 'Execution', 'Positions', 'Incidents', 'System', 'Info'];
export const MOBILE_WORKSPACES = ['Command', 'Aether Flux', 'Positions', 'Incidents'];
const slugs = ['command', 'discover', 'token', 'execution', 'positions', 'incidents', 'system', 'info'];
const filters = ['All evidence', 'Watch', 'Vetoed', 'Prime'];

export function readOperatorRoute(hash = '') {
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(search);
  const index = slugs.indexOf(path);
  const page = Number(params.get('page'));
  return {
    workspace: WORKSPACES[index] || 'Command',
    query: (params.get('q') || '').slice(0, 200),
    filter: filters.includes(params.get('filter')) ? params.get('filter') : 'All evidence',
    page: Number.isSafeInteger(page) && page >= 0 ? page : 0,
    mint: (params.get('mint') || '').slice(0, 128) || null,
  };
}

export function operatorRoute({workspace, query = '', filter = 'All evidence', page = 0, mint}) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (filter !== 'All evidence') params.set('filter', filter);
  if (page > 0) params.set('page', String(page));
  if (mint) params.set('mint', mint);
  const search = params.toString();
  return `#/${slugs[WORKSPACES.indexOf(workspace)] || 'command'}${search ? '?' + search : ''}`;
}
