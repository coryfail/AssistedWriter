# Hosted Internet access

The relay serves the browser app and forwards encrypted, bounded messages to an outbound desktop WebSocket. It has no manuscript database or volume. A share has a random routing identity and an independent 256-bit key in the browser link's URL fragment. The HTTPS service delivers the browser code and must be operated as trusted infrastructure.

## Local development

Run the relay in one terminal:

```sh
npm run build
npm run relay
```

Build and launch the desktop in a second terminal:

```sh
ASSISTED_WRITER_RELAY_URL=http://127.0.0.1:48732 npm start
```

Open a disposable book, create a private link from **Web Access**, and open it on the same Mac. The loopback URL is for development only and is rejected by packaged apps.

## Deployments (maintainers)

The supplied Fly config runs a single continuously available Machine. Live connections are held in memory, so do not add replicas without introducing shared routing. Deployment requires an authorized Fly account and can incur [hosting charges](https://fly.io/docs/about/pricing/).

The initial relay supports up to 48 connected desktops, with a lower per-IP limit and request and concurrency limits. It uses the Fly Proxy client IP only when running on Fly, and bounds delivered asset and encrypted payload traffic to 1 GiB per UTC day in memory. This is an abuse guardrail, not a guaranteed billing cap; it resets if the process restarts.

```sh
fly deploy --remote-only --config fly.relay.toml --ha=false
curl --fail https://assisted-writer-relay.fly.dev/health
```

New app builds default to the verified HTTPS origin at `https://assisted-writer-relay.fly.dev`. To use a different relay, override `ASSISTED_WRITER_RELAY_URL` in the build environment or the GitHub Actions repository variables. Create a private link with a disposable book to verify any new endpoint before distributing a build. The hosted origin is public configuration; there is no bundled relay password. Writers only use **Create private link** and a browser.

Turning off Web Access or leaving the shared book closes the outbound connection and invalidates the link. Brief outages reconnect with the same link while sharing stays enabled. A relay restart interrupts any save in progress; the existing draft recovery and revision checks protect the browser draft.
