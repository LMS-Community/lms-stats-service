import { Hono, Context } from 'hono'
import { z } from "zod";
import { zValidator } from '@hono/zod-validator'

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
    getVersions
} from '../../lib/stats';

// How far back do we go to consider an installation active?
const INTERVAL = 86400 * 30

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
    language?: string;
    tracks?: number;
}

const headerSchema = z.object({
    'x-lms-id': z.string().length(27),
    'user-agent': z.string().regex(uaStringCheck)
})

const inputSchema = z.object({
    version: z.string().regex(versionCheck),
    revision: z.string().max(50),
    os: z.string().max(100),   // Perl's $^O is a short string
    osname: z.string().max(20),
    platform: z.string().max(20),
    perl: z.string().max(50),
    skin: z.string().max(25),
    language: z.string().max(5).optional(),
    plugins: z.array(z.string().max(25)).max(100).optional(),
    players: z.coerce.number().int().optional(),
    playerTypes: z.null().or(z.record(z.string().max(100), z.number())).optional(),
    tracks: z.coerce.number().int().optional(),
})

app.get('/', async c => {
    return c.redirect('https://lyrion.org/analytics/', 301)
})

app.get('/api/stats', async (c: Context) => {
    try {
        return c.json(await getSummary(c.env.DB, INTERVAL))
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
        plugins: getPlugins,
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

app.post(
    '/api/instance/:id/',
    zValidator('param', z.object({ id: z.string().length(27) }), (result, c) => {
        if (!result.success) return validationError(c, result.error)
    }),
    zValidator('header', headerSchema, (result, c) => {
        if (!result.success) return validationError(c, result.error)
    }),
    zValidator('json', inputSchema, (result, c) => {
        if (!result.success) return validationError(c, result.error)
    }),
    async (c: Context) => {
        const { id } = c.req.param()
        const idHeader = c.req.header('x-lms-id') as string

        if (id !== idHeader) return validationError(c, "ID mismatch")

        let {
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
    }
)

async function validationError(c: Context, error?: any) {
    console.error(error)
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