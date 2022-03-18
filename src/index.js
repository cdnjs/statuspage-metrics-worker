const WorkersSentry = require('workers-sentry/worker');
const data = require('./data.yml');

// Util to send a text response
const textResponse = content => new Response(content, {
    headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Expires': '0',
        'Surrogate-Control': 'no-store',
    },
});

// Util to send a JSON response
const jsonResponse = obj => new Response(JSON.stringify(obj), {
    headers: {
        'Content-Type': 'application/json',
    },
});

// Fetch a monitor from UptimeRobot
const fetchUptimeRobot = (monitor, limit, skip) => {
    const end = new Date();
    end.setMinutes(end.getMinutes() - skip);

    const start = new Date(end.getTime());
    start.setMinutes(start.getMinutes() - limit);

    const params = new URLSearchParams();
    params.set('api_key', process.env.UPTIMEROBOT_AUTH);
    params.set('format', 'json');
    params.set('monitors', monitor);
    params.set('response_times', '1');
    params.set('response_times_start_date', Math.round(start.getTime() / 1000));
    params.set('response_times_end_date', Math.round(end.getTime() / 1000));

    return fetch('https://api.uptimerobot.com/v2/getMonitors', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
    }).then(req => req.json());
};

// Post data to Statuspage
const postStatuspage = (page, metric, data) => fetch(
    `https://api.statuspage.io/v1/pages/${page}/metrics/${metric}/data.json`,
    {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `OAuth ${process.env.STATUSPAGE_AUTH}`,
        },
        body: JSON.stringify({ data }),
    },
).then(req => req.json());

// Fetch data for a monitor from UptimeRobot and update Statuspage metric
const updateMetric = async (metric, limit, skip) => {
    // Get the raw data from UptimeRobot
    const rawData = await fetchUptimeRobot(metric.uptimerobot.monitor, limit, skip);

    // Send to statuspage
    await Promise.all(rawData.monitors[0].response_times.map(({ datetime, value }) => postStatuspage(
        metric.statuspage.page,
        metric.statuspage.metric,
        { timestamp: Math.floor(datetime / 60) * 60, value },
    )));
};

// Fetch all UptimeRobot monitors and update Statuspage metrics
const updateMetrics = (sentry, limit, skip) => Promise.all(
    data.metrics.map(metric => updateMetric(metric, limit, skip).catch(err => sentry.captureException(err))),
);

// Process all requests to the worker
const handleRequest = async ({ request, wait, sentry }) => {
    const url = new URL(request.url);

    // Health check route
    if (url.pathname === '/health') return textResponse('OK');

    // Get metrics route
    if (url.pathname === '/metrics') return jsonResponse(data);

    // Execute triggers route
    if (url.pathname === '/execute') {
        // Get params
        const queryLimit = parseInt(url.searchParams.get('limit'), 10);
        const querySkip = parseInt(url.searchParams.get('skip'), 10);
        const limit = isNaN(queryLimit) ? 10 : queryLimit;
        const skip = isNaN(querySkip) ? 0 : querySkip;

        // Trigger each workflow in the background after
        wait(updateMetrics(sentry, limit, skip).catch(err => sentry.captureException(err)));

        // Return all metrics
        return jsonResponse({ limit, skip, data });
    }

    // Not found
    return new Response(null, { status: 404 });
};

// Register the worker listener
addEventListener('fetch', event => {
    // Start Sentry
    const sentry = new WorkersSentry(event, process.env.SENTRY_DSN);

    // Process the event
    return event.respondWith(handleRequest({
        request: event.request,
        wait: event.waitUntil.bind(event),
        sentry,
    }).catch(err => {
        // Log & re-throw any errors
        console.error(err);
        sentry.captureException(err);
        throw err;
    }));
});

// Also listen for a cron trigger
addEventListener('scheduled', event => {
    // Start Sentry
    const sentry = new WorkersSentry(event, process.env.SENTRY_DSN);

    // Process the event
    return event.waitUntil(updateMetrics(sentry, 10, 0).catch(err => {
        // Log & re-throw any errors
        console.error(err);
        sentry.captureException(err);
        throw err;
    }));
});
