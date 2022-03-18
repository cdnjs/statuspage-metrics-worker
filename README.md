<h1 align="center">
    <a href="https://cdnjs.com"><img src="https://raw.githubusercontent.com/cdnjs/brand/master/logo/standard/dark-512.png" width="175px" alt="< cdnjs >"></a>
</h1>

<h3 align="center">The #1 free and open source CDN built to make life easier for developers.</h3>

---

## Introduction

At cdnjs, we use
[UptimeRobot](https://uptimerobot.com/?utm_source=cdnjs&utm_medium=cdnjs_link&utm_campaign=cdnjs_readme)
to provide continual, minute-by-minute monitoring of our services. This tracks our uptime across a
number of different web properties, as well as the response latency on them.

Our public status page is powered by
[Atlassian Statuspage](https://www.statuspage.io/?utm_source=cdnjs&utm_medium=cdnjs_link&utm_campaign=cdnjs_readme),
but we also like to share raw latency data for our key services on there to help with giving the
community real-time insight into performance.

To get the data from UptimeRobot to Atlassian Statuspage, we built this little Cloudflare Worker
that runs once per minute, fetching the latest latency data from UptimeRobot, transforming it and
sending it over to our Statuspage.

## Development

1. Create (or have) an UptimeRobot account with monitors configured.
2. Create (or have) an Atlassian Statuspage account with "post my own data" metrics configured.
3. Create your `development.env` file. Copy `development.env.sample` and fill out the information
   for Sentry, as well as API keys for UptimeRobot & Statuspage.
4. Update the tracked `src/data.yml` file with your UptimeRobot monitor and Statuspage metric data.
5. Authenticate with Wrangler by running `wrangler login`.
6. Update `wrangler.toml` for your account. Use `wrangler whoami` to get your account ID, update the
   value in `wranglar.toml` to match.
7. Develop with the worker by running `npm run dev`.

## Deployments

To deploy to production, run `npm run publish:production`. As this Worker is based on a cron
trigger, it is published in the Workers Dev context and does not need a set zone ID.
