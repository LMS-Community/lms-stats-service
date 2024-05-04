import { Hono } from 'hono/tiny'
import { Context } from 'hono'

import {
    ValueCountsObject,
    getCountries,
    getHistory,
    getOS,
    getPlayerCount,
    getPlayerTypes,
    getPlayers,
    getPlugins,
    getSummary,
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
    playerCount?: number;
    plugins: string[];
    skin: string;
    language: string;
    tracks?: number;
}

app.get('/', async c => {
    return c.redirect('https://lyrion.org/analytics/', 301)
})

app.get('/api/stats', async (c: Context) => {
    try {
        return c.json(await getSummary(c.env.DB, ACTIVE_INTERVAL))
    }
    catch(e) {
        console.error(e)
        return c.json({err: e}, 500)
    }
})

app.get('/api/stats/:dataset', async (c: Context) => {
    const { dataset } = c.req.param()

    if (!dataset) return c.redirect('/api/stats', 301)

    const methods: { [key: string]: (db: any, secs?: number) => Promise<ValueCountsObject[]|Object[]|number> } = {
        countries: getCountries,
        history: getHistory,
        os: getOS,
        players: getPlayers,
        playerTypes: getPlayerTypes,
        playerCount: getPlayerCount,
        plugins: (db, secs?: number) => {
            // "fast" would look up from helper table, which is updated hourly only; set to false for most accurate results (if CPU time allows)
            return getPlugins(db, secs, false /* fast */);
        },
        trackCounts: getTrackCountBins,
        versions: getVersions
    };

    const method = methods[dataset]
    if (!method) return c.text('404 Not Found', 404)

    try {
        return c.json(await method(c.env.DB))
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
    ) {
        return validationError(c)
    }

    const country = c.req.raw?.cf?.country;

    const data = stringifyDataObject({
        os, osname, platform, version, revision, perl, players, playerTypes, plugins, country, skin, language, tracks
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