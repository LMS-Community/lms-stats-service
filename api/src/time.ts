import { Hono } from 'hono/tiny'
import { DateTime } from 'luxon'

const app = new Hono()

app.get('/', async c => {
    return c.json(getTimeInformation(c.req.header('cf-timezone') || 'UTC'));
})

app.get('/tz', async c => {
    return c.text(c.req.header('cf-timezone') || 'UTC')
})

app.get('/:region/:country', async c => {
    const { region, country } = c.req.param()
    return c.json(getTimeInformation(`${region}/${country}`));
})

function getTimeInformation(timezone = 'UTC') {
    timezone = timezone.toLowerCase()
    const dateTime = DateTime.now().setZone(timezone);

    if (!dateTime.isValid) {
        return { datetime: 'Invalid timezone', timezone }
    }

    return {
        datetime: dateTime.toISO(),
        timezone: dateTime.zoneName,
        offset: dateTime.offsetNameShort,
        offsetHours: dateTime.offset / 60,
        offsetMinutes: dateTime.offset,
        isInDST: dateTime.isInDST,
    };
}

export default app
