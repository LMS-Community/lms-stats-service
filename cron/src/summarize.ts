import type { Event, ExecutionContext } from "@cloudflare/workers-types/experimental"
import { getSummary } from '../../lib/stats'

// How far back do we go to consider an installation active?
const INTERVAL = 3600 * 24 * 30

async function updateSummary(env: any) {
    try {
        const summaryData = JSON.stringify(await getSummary(env.DB, INTERVAL))

        await env.DB.prepare(`
            INSERT INTO summary ('date', data) VALUES(DATE(), json(?))
                ON CONFLICT(date) DO UPDATE SET data=json(?);
        `).bind(summaryData, summaryData).run()
    }
    catch(e) {
        console.error(e)
    }
}

export default {
    async scheduled(event: Event, env: unknown, ctx: ExecutionContext) {
        ctx.waitUntil(updateSummary(env));
    },
}