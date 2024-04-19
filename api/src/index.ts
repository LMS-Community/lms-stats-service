import { Hono, Context } from 'hono'

import {
    ValueCountsObject,
    getCountries,
    getHistory,
    getOS,
    getPlayerTypes,
    getPlayers,
    getPlugins,
    getSummary,
    getTrackCountBins,
    getVersions
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
        return c.json(await getSummary(c.env.DB))
    }
    catch(e) {
        console.error(e)
        return c.json({err: e}, 500)
    }
})

app.get('/api/stats/:dataset', async (c: Context) => {
    const { dataset } = c.req.param()

    if (!dataset) return c.redirect('/api/stats', 301)

    const methods: { [key: string]: (db: any, secs?: number) => Promise<ValueCountsObject[]|Object[]> } = {
        countries: getCountries,
        history: getHistory,
        os: getOS,
        players: getPlayers,
        playerTypes: getPlayerTypes,
        plugins: getPlugins,
        trackcounts: getTrackCountBins,
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
    const { id } = c.req.param()
    const idHeader = c.req.header('x-lms-id') as string
    const uaString = c.req.header('User-Agent') as string

    if (id !== idHeader || !uaStringCheck.test(uaString) ) return validationError(c)

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

    // TODO - better validation
    if (id.length !== 27
        || revision.length > 50
        || os.length > 100
        || osname.length > 20   // Perl's $^O is a short string
        || platform.length > 20
        || perl.length > 50
        || skin.length > 25
        || language.length > 5
        || plugins.length > 200
        || (version && !versionCheck.test(version))
        || (players && !Number.isInteger(+players))
        || (tracks && !Number.isInteger(+tracks))
        || (plugins.find(plugin => plugin.length > 25))
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