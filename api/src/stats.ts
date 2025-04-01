import { Hono } from 'hono/tiny'
import { Context } from 'hono'

const app = new Hono()

import {
    StatsDb,
    QueryArgs,
    ValueCountsObject,
    ACTIVE_INTERVAL,
    queryIdentifier
} from '../../lib/stats';

app.get('/', parseFilterFromQuery, initStatsDb, async (c: Context) => {
    const args = {
        secs: c.var.secs || ACTIVE_INTERVAL,
        keys: c.var.keys,
        values: c.var.values
    }

    const statsDb = c.var.statsDb

    try {
        return c.json({
            connectedPlayers: await statsDb.getPlayersC(args),
            countries: await statsDb.getCountriesC(args),
            os: await statsDb.getOSC(args),
            playerTypes: await statsDb.getMergedPlayerTypesC(args),
            tracks: await statsDb.getTrackCountBinsC(args),
            versions: await statsDb.getVersionsC(args)
        })
    }
    catch(e) {
        console.error(e)
        return c.json({err: e}, 500)
    }
})

app.get('/:dataset', parseFilterFromQuery, initStatsDb, async (c: Context) => {
    const dataset = c.req.param('dataset')

    if (!dataset) return c.redirect('/api/stats', 301)

    const statsDb = c.var.statsDb

    const methods: { [key: string]: (args: QueryArgs) => Promise<ValueCountsObject[]|Object[]|number> } = {
        [queryIdentifier.countries]: statsDb.getCountriesC,
        [queryIdentifier.history]: statsDb.getHistoryC,
        [queryIdentifier.language]: statsDb.getLanguagesC,
        [queryIdentifier.mergedPlayerTypes]: statsDb.getMergedPlayerTypesC,
        [queryIdentifier.os]: statsDb.getOSC,
        [queryIdentifier.perl]: statsDb.getPerlVersionsC,
        [queryIdentifier.players]: statsDb.getPlayersC,
        [queryIdentifier.playerCount]: statsDb.getPlayerCountC,
        [queryIdentifier.playerModels]: statsDb.getPlayerModelsC,
        [queryIdentifier.playerTypes]: statsDb.getPlayerTypesC,
        [queryIdentifier.plugins]: statsDb.getPluginsC,
        [queryIdentifier.servers]: statsDb.getServerCountC,
        [queryIdentifier.trackCounts]: statsDb.getTrackCountBinsC,
        [queryIdentifier.versions]: statsDb.getVersionsC
    };

    const method = methods[dataset]

    if (!method) return c.text('404 Not Found', 404)

    try {
        return c.json(await method.call(statsDb, { identifier: dataset, secs: c.var.secs, keys: c.var.keys, values: c.var.values }))
    }
    catch(e) {
        console.error(e)
        return c.json({err: e}, 500)
    }
})

async function parseFilterFromQuery(c: Context, next: Function) {
    const days = parseInt(c.req.query('days') as string)

    if (days && Number.isInteger(+days)) c.set('secs', days * 86400)

    const keys: Array<string> = []
    const values: Array<string> = []

    const acceptedParams: { [key: string]: RegExp } = {
        os: /^[a-z0-9-_]+$/i,
        osname: /^[a-z0-9-_ ()]+$/i,
        version: /^\d+\.\d+\.\d+$/,
        country: /^[A-Z]{2}$/i
    }

    Object.keys(acceptedParams).forEach(k => {
        const v = c.req.query(k)
        if (v && v.match(acceptedParams[k])) {
            keys.push(k)
            values.push(v)
        }
    })

    c.set('keys', keys)
    c.set('values', values)

    await next()
}

async function initStatsDb(c: Context, next: Function) {
    c.set('statsDb', new StatsDb(c.env.DB, c.env.QC))
    await next()
}

export default app
