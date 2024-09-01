import { Hono } from 'hono/tiny'
import { Context } from 'hono'

import {
    StatsDb,
    QueryArgs,
    ValueCountsObject,
    ACTIVE_INTERVAL,
    queryIdentifier
} from '../../lib/stats';

const app = new Hono()
const versionCheck = new RegExp(/^\d{1,2}\.\d{1,3}\.\d{1,3}$/)
const uaStringCheck = new RegExp(/^iTunes.*L(?:yrion|ogitech) M(?:usic|edia) Server/)

interface StatsData {
    os: string;
    osname: string;
    platform: string;
    version: string;
    revision: string;
    perl: string;
    players?: number;
    playerTypes?: object;
    playerModels?: object;
    playerCount?: number;
    plugins: string[];
    skin: string;
    language: string;
    tracks?: number;
}

app.get('/', async c => {
    return c.redirect('https://lyrion.org/analytics/', 301)
})

app.get('/api/stats', parseFilterFromQuery, initStatsDb, async (c: Context) => {
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

app.get('/api/stats/:dataset', parseFilterFromQuery, initStatsDb, async (c: Context) => {
    const dataset = c.req.param('dataset')

    if (!dataset) return c.redirect('/api/stats', 301)

    const statsDb = c.var.statsDb

    const methods: { [key: string]: (args: QueryArgs) => Promise<ValueCountsObject[]|Object[]|number> } = {
        [queryIdentifier.countries]: statsDb.getCountriesC,
        [queryIdentifier.history]: statsDb.getHistoryC,
        [queryIdentifier.language]: statsDb.getLanguagesC,
        [queryIdentifier.mergedPlayerTypes]: statsDb.getMergedPlayerTypesC,
        [queryIdentifier.os]: statsDb.getOSC,
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

app.post('/api/instance/:id/', async (c: Context) => {
    const ip = c.req.raw.headers.get("CF-Connecting-IP")
    const { success: rateOk } = await c.env.STATS_UPDATE_LIMITER.limit({
        key: ip
    })

    if (!rateOk) {
        c.status(429)
        return c.text(`429 Failure – rate limit exceeded, try again in a few minutes`)
    }

    const { id } = c.req.param()
    const idHeader = c.req.header('x-lms-id') as string
    const uaString = c.req.header('User-Agent') as string

    if (id !== idHeader || !uaStringCheck.test(uaString) ) return validationError(c)

    const {
        version = '',
        revision = '',
        os = '',
        osname = '',
        platform = '',
        perl = '',
        players = 0,
        playerTypes,
        playerModels,
        plugins = [],
        skin = '',
        language = '',
        tracks = 0
    } = await c.req.json() as StatsData

    if (id.length !== 27
        || revision.length > 100
        || os.length > 100
        || osname.length > 100
        || platform.length > 50
        || perl.length > 50
        || skin.length > 50
        || language.length > 5
        || plugins.length > 250
        || (version && !versionCheck.test(version))
        || (players && !Number.isInteger(+players))
        || (tracks && !Number.isInteger(+tracks))
        || (plugins.find(plugin => plugin.length > 50))
        || (playerTypes && Object.keys(playerTypes).length > 20)
        || (playerModels && Object.keys(playerModels).length > 50)
    ) {
        return validationError(c)
    }

    const country = c.req.raw?.cf?.country;

    const data = stringifyDataObject({
        os, osname, platform, version, revision, perl, players, playerTypes, playerModels, plugins, country, skin, language, tracks
    })

    const { success } = await c.env.DB.prepare(`
        INSERT INTO servers (id, created, lastseen, data) VALUES(?, DATETIME(), DATETIME(), json(?))
            ON CONFLICT(id) DO UPDATE SET lastseen=DATETIME(), data=json(?);
    `).bind(id, data, data).run()

    if (success) {
        c.status(201)
        return c.text("")
    } else {
        c.status(500)
        return c.text("Something went wrong")
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

async function validationError(c: Context) {
    console.error("Validation error", await c.req.json())
    c.status(201)
    return c.text("");
}

function stringifyDataObject(data: object) {
    // remove empty values
    Object.keys(data).forEach((key: string) => {
        const value = data[key as keyof typeof data]
        if (value === undefined || value === null || (value as string | number).toString().length === 0) {
            delete data[key as keyof typeof data];
        }
    })

    return JSON.stringify(data)
}

export default app