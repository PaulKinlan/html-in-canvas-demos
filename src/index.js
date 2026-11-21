// Worker entry. Static files in ./public are served by Workers static assets
// before this runs; only paths that are not files reach fetch().
// Keep this file a thin router: each area owns its own module.
import { Room, handleCrossContextApi } from './cross-context.js';
import { handleReports } from './reports.js';

export { Room };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/x/')) return handleCrossContextApi(request, env, ctx, url);
    if (url.pathname === '/api/reports' || url.pathname.startsWith('/api/reports/')) return handleReports(request, env, ctx, url);
    return env.ASSETS.fetch(request);
  },
};
