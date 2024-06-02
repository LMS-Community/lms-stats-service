import type { Event, ExecutionContext } from "@cloudflare/workers-types/experimental"
import {
    StatsDb,
    ValueCountsObject,
    ACTIVE_INTERVAL
} from '../../lib/stats'

interface HistoricSummary  {
    versions?: ValueCountsObject[];
    countries?: ValueCountsObject[];
    os?: ValueCountsObject[];
    connectedPlayers?: ValueCountsObject[]
    playerTypes?: ValueCountsObject[];
    playerModels?: ValueCountsObject[];
    plugins?: ValueCountsObject[];
    tracks?: ValueCountsObject[];
    players: number;
}

async function updateSummary(env: any) {
    const statsDb = new StatsDb(env.DB, env.QC)
    const args = { secs: ACTIVE_INTERVAL }

    try {
        const summaryData: HistoricSummary = {
            connectedPlayers: await statsDb.getPlayersC(args),
            countries: await statsDb.getCountriesC(args),
            os: await statsDb.getOSC(args),
            players: await statsDb.getPlayerCountC(args),
            playerTypes: await statsDb.getPlayerTypesC(args),
            playerModels: await statsDb.getPlayerModelsC(args),
            plugins: await statsDb.getPluginsC(args),
            tracks: await statsDb.getTrackCountBinsC(args),
            versions: await statsDb.getVersionsC(args)
        }

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