import type { Event, ExecutionContext } from "@cloudflare/workers-types/experimental"
import { extractPlugins, ACTIVE_INTERVAL } from '../../lib/stats'

async function updatePlugins(env: any) {
    try {
        await extractPlugins(env.DB, ACTIVE_INTERVAL)
    }
    catch(e) {
        console.error(e)
    }
}

export default {
    async scheduled(_event: Event, env: unknown, ctx: ExecutionContext) {
        ctx.waitUntil(updatePlugins(env));
    }
}