import type { Event, ExecutionContext } from "@cloudflare/workers-types/experimental"
import { StatsSummary, getPlayerCount, getPlugins, getSummary } from '../../lib/stats'

interface HistoricSummary extends StatsSummary {
    players: number
}

// How far back do we go to consider an installation active?
const INTERVAL = 3600 * 24 * 30

// Remove installations after a certain time of inactivity
const RETENTION_TIME = 86400 * 90

async function updateSummary(env: any) {
    try {
        const summaryData = await getSummary(env.DB, INTERVAL) as HistoricSummary
        summaryData.plugins = await getPlugins(env.DB, INTERVAL)
        summaryData.players = await getPlayerCount(env.DB, INTERVAL)

        const dataString = JSON.stringify(summaryData)

        await env.DB.prepare(`
            INSERT INTO summary ('date', data) VALUES(DATE(), json(?))
                ON CONFLICT(date) DO UPDATE SET data=json(?);
        `).bind(dataString, dataString).run()

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
        ctx.waitUntil(updateSummary(env));
    },
}