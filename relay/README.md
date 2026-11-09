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

## One-time deployment (maintainers)

The supplied Fly config runs a single continuously available Machine. Live connections are held in memory, so do not add replicas without introducing shared routing. Deployment requires an authorized Fly account and can incur [hosting charges](https://fly.io/docs/about/pricing/).

```sh
fly apps create YOUR_RELAY_APP
fly deploy --config fly.relay.toml --app YOUR_RELAY_APP --ha=false \
  --env RELAY_PUBLIC_ORIGIN=https://YOUR_RELAY_APP.fly.dev
curl --fail https://YOUR_RELAY_APP.fly.dev/health
```

Set the GitHub Actions repository variable `ASSISTED_WRITER_RELAY_URL` to the verified HTTPS origin, or provide it when building a signed package locally. Restart the app using the new build, create a private link with a disposable book, and verify it from cellular before distributing the build. The hosted origin is public configuration; there is no bundled relay password. Writers only use **Create private link** and a browser.

Turning off Web Access or leaving the shared book closes the outbound connection and invalidates the link. Brief outages reconnect with the same link while sharing stays enabled. A relay restart interrupts any save in progress; the existing draft recovery and revision checks protect the browser draft.
