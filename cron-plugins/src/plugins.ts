import type { Event, ExecutionContext } from "@cloudflare/workers-types/experimental"
import {
    StatsDb,
    ACTIVE_INTERVAL
} from '../../lib/stats'

async function updatePlugins(env: any) {
    const statsDb = new StatsDb(env.DB, env.QC)

    try {
        // just get the plugins list and ignore the result - we only want to fill the cache
        await statsDb.getPluginsC({ secs: ACTIVE_INTERVAL })
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