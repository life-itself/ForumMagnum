# Deploy Local With Docker

This document is for local container-build testing only.

Its purpose is to reduce Railway deployment churn by reproducing the container build locally before retrying a remote deploy.

It is not the canonical production deployment guide.

For deeper background and ongoing notes, see:

- [deployment-notes.md](/Users/rgrp/src/ForumMagnum/docs/deployment-notes.md)
- [2026-04-24-hosted-runtime-followup.md](/Users/rgrp/src/ForumMagnum/docs/plans/2026-04-24-hosted-runtime-followup.md)

## Purpose

Use this flow when:

- you want to validate the Docker image build locally
- Railway builds are failing and you want faster iteration
- you want a preflight step before `railway up`

## Prerequisites

- Docker CLI installed
- a running Docker daemon
- on this machine, Colima is a working option

If using Colima:

```bash
colima start
DOCKER_HOST=unix:///Users/rgrp/.colima/default/docker.sock docker version
```

## Build The Image Locally

From the repo root:

```bash
DOCKER_HOST=unix:///Users/rgrp/.colima/default/docker.sock \
docker build -t forummagnum-stage1:local .
```

What this validates:

- Docker build context includes the files Railway needs
- `yarn install` works in the image
- `yarn generate` works in the image
- the production-style Next build works in the image

## Expected Inputs

The Dockerfile currently bakes the stage-1 build path directly into the image build:

- `ENV_NAME=stage1Lw`
- `FORUM_TYPE=LessWrong`

The runtime environment still needs:

- `PG_URL`
- `private_expressSessionSecret`
- `PORT` if not using the default

## If The Local Build Fails

Treat the local failure as the primary debugging target.

Typical workflow:

1. fix the Dockerfile or repo code path locally
2. rerun the local build
3. only retry Railway after the local build passes

## Current Value

At the current stage of the deployment effort, local Docker builds are mainly a preflight tool for Railway.

Once the Railway deployment is fully working, this document should likely be distilled into a shorter “local preflight” section and linked from the main Railway deploy doc.
