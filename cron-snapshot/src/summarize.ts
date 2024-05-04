import type { Event, ExecutionContext } from "@cloudflare/workers-types/experimental"
import { StatsSummary, getPlayerCount, getPlugins, getSummary, ACTIVE_INTERVAL } from '../../lib/stats'

interface HistoricSummary extends StatsSummary {
    players: number
}

async function updateSummary(env: any) {
    try {
        const summaryData = await getSummary(env.DB, ACTIVE_INTERVAL) as HistoricSummary
        summaryData.plugins = await getPlugins(env.DB, ACTIVE_INTERVAL, true /* fast */)
        summaryData.players = await getPlayerCount(env.DB, ACTIVE_INTERVAL)

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
    async scheduled(_event: Event, env: unknown, ctx: ExecutionContext) {
        ctx.waitUntil(updateSummary(env));
    },
}