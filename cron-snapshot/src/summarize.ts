import type { Event, ExecutionContext } from "@cloudflare/workers-types/experimental"
import {
    getCountries,
    getOS,
    getPlayerCount,
    getPlayers,
    getPlayerTypes,
    getPlayerModels,
    getPlugins,
    getTrackCountBins,
    getVersions,
    ACTIVE_INTERVAL
} from '../../lib/stats'

interface HistoricSummary  {
    versions?: object[];
    countries?: object[];
    os?: object[];
    connectedPlayers?: object[]
    playerTypes?: object[];
    playerModels?: object[];
    plugins?: object[];
    tracks?: object[];
    players: number;
}

async function updateSummary(env: any) {
    try {
        const summaryData: HistoricSummary = {
            connectedPlayers: await getPlayers(env.DB, ACTIVE_INTERVAL),
            countries: await getCountries(env.DB, ACTIVE_INTERVAL),
            os: await getOS(env.DB, ACTIVE_INTERVAL),
            players: await getPlayerCount(env.DB, ACTIVE_INTERVAL),
            playerTypes: await getPlayerTypes(env.DB, ACTIVE_INTERVAL),
            playerModels: await getPlayerModels(env.DB, ACTIVE_INTERVAL),
            plugins: await getPlugins(env.DB, ACTIVE_INTERVAL, true /* fast */),
            tracks: await getTrackCountBins(env.DB, ACTIVE_INTERVAL),
            versions: await getVersions(env.DB, ACTIVE_INTERVAL)
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