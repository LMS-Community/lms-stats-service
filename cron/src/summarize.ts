import type { Event, ExecutionContext } from "@cloudflare/workers-types/experimental"
import { getSummary } from '../../lib/stats'

// How far back do we go to consider an installation active?
const INTERVAL = 3600 * 24 * 30

async function updateSummary(env: any) {
    try {
        const summaryData = await getSummary(env.DB, INTERVAL)

        const { results } = env.DB.prepare(`
            SELECT SUM(JSON_EXTRACT(data, '$.players')) AS p
            FROM servers
            WHERE UNIXEPOCH(DATETIME()) - UNIXEPOCH(lastseen) < ${INTERVAL}
        `)

        if (results) summaryData.players = results

        const dataString = JSON.stringify(summaryData)

        await env.DB.prepare(`
            INSERT INTO summary ('date', data) VALUES(DATE(), json(?))
                ON CONFLICT(date) DO UPDATE SET data=json(?);
        `).bind(dataString, dataString).run()
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