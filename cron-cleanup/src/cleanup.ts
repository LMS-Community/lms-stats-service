import type { Event, ExecutionContext } from "@cloudflare/workers-types/experimental"

// Remove installations after a certain time of inactivity
const RETENTION_TIME = 86400 * 90

async function cleanupStaleData(env: any) {
    try {
        // expire stale data
        await env.DB.prepare('DELETE FROM servers WHERE UNIXEPOCH(DATETIME()) - UNIXEPOCH(lastseen) > ?')
            .bind(RETENTION_TIME).run()
    }
    catch(e) {
        console.error(e)
    }
}

export default {
    async scheduled(_event: Event, env: unknown, ctx: ExecutionContext) {
        ctx.waitUntil(cleanupStaleData(env));
    },
}