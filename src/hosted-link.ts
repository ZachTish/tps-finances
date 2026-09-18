import type { LinkResult } from "./finance-relay";
export function validHostedLink(url: string): boolean {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && u.hostname === 'secure.plaid.com' && u.pathname.startsWith('/hl/') && !u.username && !u.password && !u.port;
    }
    catch {
        return false;
    }
}
/** Inspect every session before treating an exit as cancellation; reopening a URL starts another session. */
export function parseHostedLinkResult(response: any, updateMode: boolean): LinkResult {
    const sessions = Array.isArray(response.link_sessions) ? response.link_sessions : [];
    const adds = sessions.flatMap((session: any) => Array.isArray(session.results?.item_add_results) && session.results.item_add_results.length
        ? session.results.item_add_results : session.on_success ? [{ public_token: session.on_success.public_token, institution: session.on_success.metadata?.institution }] : []);
    const tokens = [...new Set(adds.map((result: any) => result.public_token).filter((value: unknown): value is string => typeof value === 'string' && value.length > 0))];
    if (tokens.length > 1)
        throw new Error('This sign-in returned multiple institutions. Review the connection on the Controller.');
    if (updateMode && (adds.length || sessions.some((session: any) => session.events?.some((event: any) => event.event_name === 'HANDOFF'))))
        return { state: 'complete' };
    if (tokens.length === 1) {
        const result = adds.find((item: any) => item.public_token === tokens[0]);
        return { state: 'complete', publicToken: tokens[0] as string, institutionName: String(result.institution?.name || 'Institution') };
    }
    // An exited session can be reopened until the hosted URL expires. Do not terminate early.
    return { state: 'waiting' };
}
