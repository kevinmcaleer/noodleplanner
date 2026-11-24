# Auto-deploying merged PRs to the nodes

```
merge to main -> .github/workflows/publish-image.yml -> ghcr.io/kevinmcaleer/noodleplanner:main
                                                      -> Watchtower on each node (polls every 60s)
                                                      -> pulls the image, restarts the container
```

A merge is live on the nodes roughly 5-15 minutes later (the multi-arch build
is most of that), with no one touching a node. Only containers labelled
`com.centurylinklabs.watchtower.enable=true` are updated.

## One-time setup

**1. GitHub (once).** The workflow publishes with the built-in `GITHUB_TOKEN`; nothing to add.
After the first run, the packages `noodleplanner` and `noodleplanner-docs` appear under
your profile > Packages. They are private because the repo is. Leave them private.

**2. A read-only registry token (once).** GitHub > Settings > Developer settings >
Personal access tokens > Tokens (classic) > scope **`read:packages`** only.

**3. On each node:**

```bash
cd ~/noodleplanner && git pull          # gets deploy/
echo <TOKEN> | docker login ghcr.io -u kevinmcaleer --password-stdin
mkdir -p data && sudo chown 1000:1000 data     # skip if ./data already exists
docker compose down                      # stop the old build-from-source stack
cd deploy && docker compose up -d
```

`docker compose down` first matters: both stacks use the container names
`noodleplanner`, `noodleplanner-docs` and `noodleplanner-tunnel`, and 8007 can
only be bound once. Run the compose file from `deploy/` so `./data` resolves
there; if your existing database is in `~/noodleplanner/data`, either
`mv ../data .` or change the volume to `../data:/data`.

**4. Check it.** `docker compose logs -f watchtower` shows each poll. To test
end to end, merge any PR and watch `docker ps` for the container's age reset.

## Notes

- The root `docker-compose.yml` is unchanged. It bind-mounts `./packages` with
  `--reload`, which would shadow whatever the image contains, so it is not used
  for the nodes.
- Roll back by pinning a `sha-<commit>` tag in `deploy/docker-compose.yml`
  (remove the watchtower label on that service so it stops moving).
- Lockfile-driven dependency changes need no extra step: they are baked into
  the image at build time.
- If the nodes are x86, arm64 can be dropped from the workflow's `platforms`
  to roughly halve build time.
- Set the repo variable `CI_RUNS_ON` (see `ci/README.md`) to build on a
  self-hosted runner; otherwise the build runs on GitHub-hosted minutes.
