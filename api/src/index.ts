import { Hono } from 'hono/tiny'
import { Context } from 'hono'

import {
    ValueCountsObject,
    getCountries,
    getHistory,
    getOS,
    getPlayerCount,
    getPlayerModels,
    getPlayerTypes,
    getMergedPlayerTypes,
    getPlayers,
    getPlugins,
    getTrackCountBins,
    getVersions,
    ACTIVE_INTERVAL
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

app.get('/api/stats', parseFilterFromQuery, async (c: Context) => {
    try {
        const secs = c.var.secs || ACTIVE_INTERVAL
        const keys = c.var.keys
        const values = c.var.values

        return c.json({
            connectedPlayers: await getPlayers(c.env.DB, secs, keys, values),
            countries: await getCountries(c.env.DB, secs, keys, values),
            os: await getOS(c.env.DB, secs, keys, values),
            playerTypes: await getMergedPlayerTypes(c.env.DB, secs, keys, values),
            tracks: await getTrackCountBins(c.env.DB, secs, keys, values),
            versions: await getVersions(c.env.DB, secs, keys, values)
        })
    }
    catch(e) {
        console.error(e)
        return c.json({err: e}, 500)
    }
})

app.get('/api/stats/:dataset', parseFilterFromQuery, async (c: Context) => {
    const dataset = c.req.param('dataset')

    if (!dataset) return c.redirect('/api/stats', 301)

    const methods: { [key: string]: (db: any, secs: number, keys: Array<string>, values: Array<string>) => Promise<ValueCountsObject[]|Object[]|number> } = {
        countries: getCountries,
        history: getHistory,
        os: getOS,
        players: getPlayers,
        playerTypes: getPlayerTypes,
        playerModels: getPlayerModels,
        mergedPlayerTypes: getMergedPlayerTypes,
        playerCount: getPlayerCount,
        plugins: (db, secs?: number) => {
            return getPlugins(db, c.env.QC, secs, !secs && !c.var.keys.length /* fast */, c.var.keys, c.var.values);
        },
        trackCounts: getTrackCountBins,
        versions: getVersions
    };

    const method = methods[dataset]
    if (!method) return c.text('404 Not Found', 404)

    try {
        return c.json(await method(c.env.DB, c.var.secs, c.var.keys, c.var.values))
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

async function validationError(c: Context) {
    console.error(await c.req.json())
    c.status(201)
    return c.text("");
}

function stringifyDataObject(data: object) {
    Object.keys(data).forEach((key: string) => {
        const value = data[key as keyof typeof data]
        if (value === undefined || value === null || (value as string | number).toString().length === 0) {
            delete data[key as keyof typeof data];
        }
    })

    return JSON.stringify(data)
}

export default app